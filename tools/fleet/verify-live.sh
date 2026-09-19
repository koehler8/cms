#!/bin/zsh
# verify-live.sh — after a push, confirm the site's Amplify deploy and that
# production is really serving the new build.
#
#   tools/fleet/verify-live.sh <site-dir-name> [expected-vue-version]
#
# One look, no waiting: prints PENDING / RUNNING and exits 3 if the job for the
# site's HEAD commit has not finished, so the caller decides when to look again.
#
# Three things learned the hard way (2026-09-19) are baked in:
#   - the Amplify console's all-apps "Updated" column is when the app's SETTINGS
#     last changed, not when it last deployed; the job list is the truth.
#   - asset hashes cannot identify the live build: Amplify's Linux build hashes
#     differently from a Mac build of the same commit, and a good dependency bump
#     leaves the HTML identical. The embedded Vue version string can.
#   - that string is not always in vendor-vue-*.js (sites that bundle the crypto
#     extension put it in vendor-charts-*), so every chunk is searched, and the
#     fetch must ask for --compressed or the body is unreadable.

set -u
SITE="${1:?usage: verify-live.sh <site-dir-name> [expected-vue-version]}"
WANT_VUE="${2:-3.5.43}"
HERE="${0:A:h}"
ROOT="${FLEET_ROOT:-${HERE:h:h:h}}"
REGION="${AWS_REGION:-us-east-1}"
cd "$ROOT/$SITE" || { echo "no such site: $ROOT/$SITE"; exit 2; }

SHA=$(git rev-parse HEAD)
read -r APP NAME <<<"$(aws amplify list-apps --region $REGION --max-results 100 \
  --query "apps[?repository=='https://github.com/koehler8/$SITE'].[appId,name]" --output text | head -1)"
[[ -n "${APP:-}" ]] || { echo "$SITE: no Amplify app found for this repo"; exit 2; }

JOB=$(aws amplify list-jobs --app-id "$APP" --branch-name main --region $REGION --max-items 5 \
  --query "jobSummaries[?commitId=='$SHA'] | [0].[jobId,status]" --output text 2>/dev/null | head -1)
STATUS=$(echo "$JOB" | awk '{print $2}')
case "$STATUS" in
  SUCCEED) ;;
  ""|None) echo "$SITE: no Amplify job yet for ${SHA:0:7} ($NAME, $APP)"; exit 3 ;;
  FAILED|CANCELLED) echo "$SITE: Amplify job $(echo $JOB | awk '{print $1}') $STATUS for ${SHA:0:7} — https://$REGION.console.aws.amazon.com/amplify/apps/$APP"; exit 1 ;;
  *) echo "$SITE: Amplify job $(echo $JOB | awk '{print $1}') is $STATUS for ${SHA:0:7}"; exit 3 ;;
esac

URL=$(jq -r '.url // .["site.url"] // empty' site/content/en/site.json 2>/dev/null)
[[ -n "$URL" ]] || URL="https://$NAME"
URL="${URL%/}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fetch() { curl -sL --compressed --max-time 20 "$@"; }

# every sitemap URL answers 200 (all of them up to 80; beyond that, an even sample)
fetch "$URL/sitemap.xml" -o "$T/sitemap.xml"
LOCS=($(grep -o '<loc>[^<]*</loc>' "$T/sitemap.xml" | sed 's/<[^>]*>//g'))
TOTAL=${#LOCS}
if (( TOTAL > 80 )); then STEP=$(( TOTAL / 80 + 1 )); PICK=(); for ((i=1;i<=TOTAL;i+=STEP)); do PICK+=($LOCS[$i]); done; else PICK=($LOCS); fi
# Redirects are followed: without site.trailingSlash the sitemap lists /about and
# Amplify 301s it to /about/ (nested dirStyle) — documented and harmless. What
# must hold is that every URL ENDS at a 200.
BAD=()
HOPS=0
for u in $PICK; do
  read -r code hops <<<"$(curl -sL -o /dev/null -w '%{http_code} %{num_redirects}' --max-time 20 "$u")"
  [[ "$code" == 200 ]] || BAD+=("$code $u")
  (( hops > 0 )) && HOPS=$((HOPS+1))
done

# the embedded Vue version, searched across every chunk reachable from the home page
fetch "$URL/" -o "$T/index.html"
grep -o '/assets/[A-Za-z0-9_.-]*\.js' "$T/index.html" | sort -u > "$T/chunks"
for round in 1 2; do
  for a in $(cat "$T/chunks"); do [[ -f "$T/js$a" ]] || { mkdir -p "$T/js/assets"; fetch "$URL$a" -o "$T/js$a"; }; done
  cat "$T"/js/assets/*.js 2>/dev/null | grep -o '[A-Za-z0-9_.-]*-[A-Za-z0-9_-]\{8\}\.js' | sed 's#^#/assets/#' | sort -u >> "$T/chunks"
  sort -u -o "$T/chunks" "$T/chunks"
done
VUES=$(cat "$T"/js/assets/*.js 2>/dev/null | grep -o '3\.[0-9]\.[0-9][0-9]*' | sort | uniq -c | sort -rn | awk '{print $2}' | head -3 | tr '\n' ' ')
ROBOTS=$(grep -o '<meta name="robots"[^>]*>' "$T/index.html" | head -1)

printf "%s: job %s SUCCEED %s | %s | sitemap %d urls, checked %d, not-200: %d (%d via slash redirect) | vue on live: %s| home robots: %s\n" \
  "$SITE" "$(echo $JOB | awk '{print $1}')" "${SHA:0:7}" "$URL" "$TOTAL" "${#PICK}" "${#BAD}" "$HOPS" "$VUES" "${ROBOTS:-none}"
(( ${#BAD} == 0 )) || { printf '  %s\n' $BAD | head -5; exit 1; }
[[ " $VUES" == *" $WANT_VUE "* ]] || { echo "  expected Vue $WANT_VUE in the live bundle"; exit 1; }
