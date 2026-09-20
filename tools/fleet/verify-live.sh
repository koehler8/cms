#!/bin/zsh
# verify-live.sh — after a push, confirm the site's Amplify deploy and that
# production is really serving the new build.
#
#   tools/fleet/verify-live.sh <site-dir-name> [expected-vue-version | snapshot]
#   NODE_WANT=22.23.2 NPM_WANT='10.9.*' tools/fleet/verify-live.sh <site-dir-name>   (after a Node move)
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
SITE="${1:?usage: verify-live.sh <site-dir-name> [expected-vue-version | snapshot]}"
MODE="${2:-}"
WANT_VUE="3.5.43"
[[ -n "$MODE" && "$MODE" != snapshot ]] && WANT_VUE="$MODE"
HERE="${0:A:h}"
ROOT="${FLEET_ROOT:-${HERE:h:h:h}}"
REGION="${AWS_REGION:-us-east-1}"
SNAP="${FLEET_SCRATCH:-${TMPDIR:-/tmp}/fleet-bump}/$SITE-live-assets.txt"
cd "$ROOT/$SITE" || { echo "no such site: $ROOT/$SITE"; exit 2; }

# `snapshot` — run BEFORE a push. Records the entry-asset names production is
# serving right now, so the post-push run can prove the build actually changed.
# Needed when the Vue version cannot tell two builds apart: a framework-only
# release (cms 1.3.0 -> 1.3.1) ships the same Vue, and adds no string literal
# that survives minification. cms is bundled into the entry chunk, so its hash
# must move.
entry_assets() { curl -sL --compressed --max-time 20 "$1/" | grep -o '/assets/[A-Za-z0-9_.-]*\.\(js\|css\)' | sort -u; }
if [[ "$MODE" == snapshot ]]; then
  URL=$(jq -r '.url // .["site.url"] // empty' site/content/en/site.json 2>/dev/null); URL="${URL%/}"
  [[ -n "$URL" ]] || { echo "$SITE: no site url in site.json — cannot snapshot"; exit 2; }
  mkdir -p "${SNAP:h}"
  entry_assets "$URL" > "$SNAP"
  [[ -s "$SNAP" ]] || { echo "$SITE: snapshot came back empty from $URL"; exit 2; }
  echo "$SITE: snapshot of $(wc -l < "$SNAP" | tr -d ' ') live entry assets -> $SNAP"
  exit 0
fi

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

# NODE_WANT=<version> — prove which Node BUILT the deployed job. A Node-only
# change can leave every asset byte-identical, so neither the Vue version nor a
# changed entry-asset set can show it landed; the build log can. nvm prints
# "Now using node v22.23.2 (npm v10.9.8)" — once for `nvm install`, once for
# `nvm use`. EVERY such line must name the wanted version: a second, different
# one would mean something later in the build switched Node back.
# NPM_WANT is an optional glob for the npm in that line (e.g. '10.9.*').
NODE_LINE=""
if [[ -n "${NODE_WANT:-}" ]]; then
  JID=$(echo $JOB | awk '{print $1}')
  LOGURL=$(aws amplify get-job --app-id "$APP" --branch-name main --job-id "$JID" --region $REGION \
    --query "job.steps[?stepName=='BUILD'].logUrl | [0]" --output text 2>/dev/null)
  BLOG=$(curl -sL --compressed --max-time 30 "$LOGURL" 2>/dev/null)
  [[ -n "$BLOG" ]] || { echo "$SITE: could not fetch the BUILD log for job $JID — Node version UNKNOWN (not a pass)"; exit 1; }
  USING=$(echo "$BLOG" | grep -o 'Now using node v[0-9.]* (npm v[0-9.]*)' | sort -u)
  [[ -n "$USING" ]] || { echo "$SITE: job $JID's build log has no 'Now using node' line — Node version UNKNOWN (not a pass)"; exit 1; }
  if [[ "$(echo "$USING" | wc -l | tr -d ' ')" != 1 || "$USING" != "Now using node v$NODE_WANT (npm v"* ]]; then
    echo "$SITE: job $JID did NOT build on Node $NODE_WANT alone — the log says:"; echo "$USING" | sed 's/^/  /'; exit 1
  fi
  BUILT_NPM=$(echo "$USING" | grep -o 'npm v[0-9.]*' | sed 's/npm v//')
  [[ -z "${NPM_WANT:-}" || "$BUILT_NPM" == ${~NPM_WANT} ]] || { echo "$SITE: built on npm $BUILT_NPM, wanted $NPM_WANT"; exit 1; }
  FAV=$(echo "$BLOG" | grep -ci 'favicon')
  NODE_LINE="built on node v$NODE_WANT / npm $BUILT_NPM per the build log (favicon lines: $FAV) | "
fi

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

printf "%s: job %s SUCCEED %s | ${NODE_LINE//\%/%%}%s | sitemap %d urls, checked %d, not-200: %d (%d via slash redirect) | vue on live: %s| home robots: %s\n" \
  "$SITE" "$(echo $JOB | awk '{print $1}')" "${SHA:0:7}" "$URL" "$TOTAL" "${#PICK}" "${#BAD}" "$HOPS" "$VUES" "${ROBOTS:-none}"
(( ${#BAD} == 0 )) || { printf '  %s\n' $BAD | head -5; exit 1; }
[[ " $VUES" == *" $WANT_VUE "* ]] || { echo "  expected Vue $WANT_VUE in the live bundle"; exit 1; }

# If a pre-push snapshot exists, the build must have visibly changed. Still
# identical right after SUCCEED means the edge has not switched over yet, which
# is "look again" (3), not a failure.
if [[ -s "$SNAP" ]]; then
  NOW=$(grep -o '/assets/[A-Za-z0-9_.-]*\.\(js\|css\)' "$T/index.html" | sort -u)
  if [[ "$NOW" == "$(cat "$SNAP")" ]]; then
    echo "  live entry assets are still the pre-push set — the new build is not being served yet"; exit 3
  fi
  echo "  build changed: $(comm -13 "$SNAP" <(echo "$NOW") | wc -l | tr -d ' ') new entry asset(s) since the pre-push snapshot"
  # RENAMED, not deleted: this check is consumed on first use, and an earlier
  # version silently dropped it on any later run. Calling this script twice
  # (an `until` loop that greps its output, then a second call to print it) then
  # reports SUCCEED with no build-change clause at all -- which reads exactly
  # like a pass. Keeping the used snapshot lets the second call say so.
  mv -f "$SNAP" "$SNAP.used"
elif [[ -s "$SNAP.used" ]]; then
  echo "  build change: already verified by an earlier run of this script (snapshot consumed)"
else
  echo "  build change: NOT CHECKED — no pre-push snapshot (ship-site.sh takes one; a cms release leaves"
  echo "                every page identical, so without it nothing here can tell the new build from the old)"
fi
