#!/bin/zsh
# ship-site.sh — commit and push a site that bump-site.sh marked READY.
#
#   tools/fleet/ship-site.sh <site-dir-name> [note]
#
# It refuses unless ALL of these hold, because each one has bitten:
#   - the ledger's LAST entry for the site is READY (a later failed run voids an
#     earlier pass);
#   - the only changed files are package.json / package-lock.json;
#   - origin/main has not moved since the driver ran (someone else pushed —
#     re-run the driver on the new base rather than pushing over it).
# It takes a live snapshot first (verify-live.sh snapshot) so the post-push check
# can prove the build changed, and it FAILS LOUDLY on a rejected push: an earlier
# version printed "pushed" over GitHub's "protected branch hook declined"
# (site-bang's main requires the `verify` check — that repo goes through a PR).
#
# The commit message is generated from the ledger and the before/after lockfile,
# so every site's commit carries its own measured numbers.
#
# Environment: FLEET_ROOT, FLEET_SCRATCH (as bump-site.sh) · NO_PUSH=1 to commit
# only · SUBJECT="..." to override the subject line · COMMIT_TRAILER="Co-Authored-By: …"
# appended verbatim (whoever runs this attributes their own commits).

set -u
SITE="${1:?usage: ship-site.sh <site-dir-name> [note]}"
NOTE="${2:-}"
HERE="${0:A:h}"
ROOT="${FLEET_ROOT:-${HERE:h:h:h}}"
S="${FLEET_SCRATCH:-${TMPDIR:-/tmp}/fleet-bump}"
cd "$ROOT/$SITE" || { echo "no such site: $ROOT/$SITE"; exit 2; }

L=$(grep "\"site\":\"$SITE\"" "$S/ledger.jsonl" 2>/dev/null | tail -1)
[[ "$(echo "$L" | jq -r .result 2>/dev/null)" == READY ]] || { echo "$SITE: last ledger entry is not READY — run bump-site.sh first"; exit 1; }
changed=$(git status --short | awk '{print $2}' | sort | tr '\n' ' ')
[[ "$changed" == "package-lock.json package.json " || "$changed" == "package-lock.json " ]] || { echo "$SITE: unexpected changes: [$changed]"; exit 1; }
git fetch -q origin
[[ "$(git rev-list --count HEAD..origin/main)" == 0 ]] || { echo "$SITE: origin/main moved — re-run the driver on the new base"; exit 1; }

B="$S/$SITE-lock-before.json"
v() { jq -r --arg k "node_modules/$1" '.packages[$k].version // "-"' "${2:-package-lock.json}"; }
moved=$(for p in @koehler8/cms vite rolldown vue vue-router @vitejs/plugin-vue fast-uri nanoid postcss sharp undici axios ws form-data; do
  a=$(v $p "$B"); b=$(v $p); [[ "$a" != "$b" && "$b" != "-" ]] && printf "  %s %s -> %s\n" "$p" "$a" "$b"; done)
only_cms=$([[ "$(echo "$moved" | grep -c .)" == 1 && "$moved" == *"@koehler8/cms"* ]] && echo yes || echo no)

if [[ -n "${SUBJECT:-}" ]]; then subject="$SUBJECT"
elif [[ "$only_cms" == yes ]]; then subject="chore(deps): @koehler8/cms $(v @koehler8/cms "$B") -> $(v @koehler8/cms)"
elif [[ "$(v @koehler8/cms "$B")" == "$(v @koehler8/cms)" ]]; then subject="chore(deps): in-range refresh (vite $(v vite), vue $(v vue))"
else subject="chore(deps): bump @koehler8/cms to $(v @koehler8/cms) + in-range refresh"; fi

pages=$(echo "$L" | jq -r .pages); theme=$(echo "$L" | jq -r .theme); rss=$(echo "$L" | jq -r .peakRssMb)
checks=$(echo "$L" | jq -r .checks); audit=$(echo "$L" | jq -c .audit)
scope="Dependency versions only; Node stays 20.19.0 / npm 10.8. No visible change."
[[ "$only_cms" == yes ]] && scope="Framework release only: exactly one lockfile entry moved (asserted by the driver's CMS_ONLY gate). Node stays 20.19.0 / npm 10.8."

# before the push, so the post-push verify-live run can prove the build changed
"$HERE/verify-live.sh" "$SITE" snapshot >/dev/null 2>&1 || echo "$SITE: (no live snapshot — verify-live will rely on the Amplify job alone)"

git add package.json package-lock.json
git commit -q -F - <<EOF
$subject

$scope

$moved

Gated by cms tools/fleet/bump-site.sh before this commit:
- check-site-lockfile clean; npm ls valid; zero EBADENGINE; overrides
  unchanged; frozen packages (pinia, @unhead/vue, vite-ssg, extensions,
  themes, wallet + chart libs) did not move.
- Amplify rehearsal in a clean copy: \`npm install --prefer-offline\`
  leaves the lockfile byte-identical, \`npm ci\` passes, a linux-x64
  install materialises both native bindings.
- Built as amplify.yml builds it, before and after: $pages pages identical
  on route list, SEO head, structure and text; sitemap.xml + robots.txt
  byte-identical; theme unchanged ($theme CSS custom-property
  declarations); peak RSS ${rss} MB; acceptance checks green: $checks.
- npm audit after: $audit
${NOTE:+
$NOTE
}
Rollback: git revert this commit and push.
${COMMIT_TRAILER:+
$COMMIT_TRAILER}
EOF

if [[ -n "${NO_PUSH:-}" ]]; then
  echo "$SITE: committed (not pushed) $(git log --oneline -1 | cut -c1-72)"
elif git push -q 2>"$S/$SITE-push.err"; then
  echo "$SITE: pushed $(git log --oneline -1 | cut -c1-72)"
else
  echo "$SITE: PUSH FAILED — committed locally only:"; tail -4 "$S/$SITE-push.err"; exit 1
fi
