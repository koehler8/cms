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
# The subject and the "what moved" list come from the driver's own ledger entry
# whenever it has one (`moved`, recorded by the NAMED_ONLY and CMS_PLUS gates).
# The older fallback computes them over a fixed package list, which cannot see a
# package those modes exist to move — `ethers` is not on it, so a NAMED_ONLY
# commit would have shipped with an empty body.
#
# SHIP_MODE=node ships a site that node-site.sh marked READY instead: the allow-
# list becomes exactly `.nvmrc amplify.yml`, the ledger verdict must come from the
# node track (a dependency pass's READY never ships a Node move, or the reverse),
# and no live snapshot is taken — a Node-only change can leave every asset
# byte-identical, so verify-live proves it from the Amplify build log instead
# (NODE_WANT=<pin> verify-live.sh <site>).
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
MODE="${SHIP_MODE:-deps}"
[[ "$MODE" == deps || "$MODE" == node ]] || { echo "SHIP_MODE must be 'deps' or 'node'"; exit 2; }
[[ "$(echo "$L" | jq -r .result 2>/dev/null)" == READY ]] || { echo "$SITE: last ledger entry is not READY — run the driver first"; exit 1; }
TRACK=$(echo "$L" | jq -r '.track // "deps"')
[[ "$TRACK" == "$MODE" ]] || { echo "$SITE: the last READY verdict is from the '$TRACK' track, not '$MODE'"; exit 1; }
changed=$(git status --short | awk '{print $2}' | sort | tr '\n' ' ')
if [[ "$MODE" == node ]]; then
  [[ "$changed" == ".nvmrc amplify.yml " ]] || { echo "$SITE: unexpected changes: [$changed] (node mode ships exactly .nvmrc + amplify.yml)"; exit 1; }
elif [[ "$(grep "\"site\":\"$SITE\"" "$S/ledger.jsonl" 2>/dev/null | tail -1 | jq -r '.mode // "deps"')" == remove ]]; then
  # a removal may also have to unregister the extension from vite.config.js --
  # the one case where that never-touch file legitimately changes
  [[ "$changed" == "package-lock.json package.json " || "$changed" == "package-lock.json package.json vite.config.js " ]] \
    || { echo "$SITE: unexpected changes: [$changed] (a removal ships package.json + lockfile, plus vite.config.js only when unregistering)"; exit 1; }
else
  [[ "$changed" == "package-lock.json package.json " || "$changed" == "package-lock.json " ]] || { echo "$SITE: unexpected changes: [$changed]"; exit 1; }
fi
git fetch -q origin
[[ "$(git rev-list --count HEAD..origin/main)" == 0 ]] || { echo "$SITE: origin/main moved — re-run the driver on the new base"; exit 1; }

push_or_report() {
  if [[ -n "${NO_PUSH:-}" ]]; then
    echo "$SITE: committed (not pushed) $(git log --oneline -1 | cut -c1-72)"
  elif git push -q 2>"$S/$SITE-push.err"; then
    echo "$SITE: pushed $(git log --oneline -1 | cut -c1-72)"
  else
    echo "$SITE: PUSH FAILED — committed locally only:"; tail -4 "$S/$SITE-push.err"; exit 1
  fi
}

if [[ "$MODE" == node ]]; then
  lf() { echo "$L" | jq -r ".$1"; }
  from=$(lf nodeFrom); to=$(lf node); npmv=$(lf npm)
  [[ "$(cat .nvmrc)" == "$to" ]] || { echo "$SITE: .nvmrc is $(cat .nvmrc) but the ledger verdict is for Node $to"; exit 1; }
  git diff --quiet HEAD -- package.json package-lock.json || { echo "$SITE: package.json / lockfile differ from HEAD"; exit 1; }
  # a stale snapshot would make verify-live wait for a bundle change that may never come
  rm -f "$S/$SITE-live-assets.txt"
  git add .nvmrc amplify.yml
  git commit -q -F - <<NODEMSG
${SUBJECT:-build: Node $from -> $to (npm $npmv)}

Node version only. Node 20 reached end-of-life on 2026-04-30; 22 is the
newest line that still ships npm 10. Exactly two lines change: .nvmrc and
the \`nvm install\` line in amplify.yml. package.json and package-lock.json
are byte-identical. No visible change.

Gated by cms tools/fleet/node-site.sh before this commit:
- Baseline built under Node $from, then rebuilt under Node $to as
  amplify.yml builds it: $(lf pages) pages identical on route list, SEO head,
  structure and text; sitemap.xml + robots.txt byte-identical; theme
  unchanged ($(lf theme) CSS custom-property declarations); peak RSS
  $(lf peakRssMbBefore) -> $(lf peakRssMb) MB; acceptance checks green: $(lf checks).
- npm $npmv leaves the lockfile byte-identical after Amplify's exact
  install and after \`npm ci\`; zero EBADENGINE; a linux-x64 install
  materialises both native bindings.
- Amplify's cached node_modules crosses this change, so: all $(lf nativeBinaries)
  native binaries are N-API (not tied to a Node ABI), and the preBuild
  steps pass under $to on a tree installed under $from.
${NOTE:+
$NOTE
}
Proof of deploy is the Amplify build log ("Now using node v$to"), not
the bundle: a Node-only change need not move any asset hash.
Rollback: git revert this commit and push (Amplify installs $from again).
${COMMIT_TRAILER:+
$COMMIT_TRAILER}
NODEMSG
  push_or_report
  exit 0
fi

B="$S/$SITE-lock-before.json"
v() { jq -r --arg k "node_modules/$1" '.packages[$k].version // "-"' "${2:-package-lock.json}"; }
BUMP_MODE=$(echo "$L" | jq -r '.mode // "deps"')
names=($(echo "$L" | jq -r '.names // [] | .[]'))

if [[ "$(echo "$L" | jq -r '.moved // [] | length')" != 0 ]]; then
  # the gate's own list: every lockfile entry it saw change, named package or
  # dependency of one
  moved=$(echo "$L" | jq -r '.moved[] | "  " + .')
else
  moved=$(for p in @koehler8/cms vite rolldown vue vue-router @vitejs/plugin-vue fast-uri nanoid postcss sharp undici axios ws form-data; do
    a=$(v $p "$B"); b=$(v $p); [[ "$a" != "$b" && "$b" != "-" ]] && printf "  %s %s -> %s\n" "$p" "$a" "$b"; done)
fi
only_cms=$([[ "$(echo "$moved" | grep -c .)" == 1 && "$moved" == *"@koehler8/cms"* ]] && echo yes || echo no)

# what the OPERATOR named that actually moved — the subject speaks about those,
# not about the transitive packages they dragged
headline=$(for n in $names; do
  a=$(v $n "$B"); b=$(v $n); [[ "$a" != "$b" && "$b" != "-" ]] && printf "%s %s -> %s, " "$n" "$a" "$b"; done)
headline="${headline%, }"
headlineCount=0
[[ -n "$headline" ]] && headlineCount=$(( $(echo "$headline" | tr -cd ',' | wc -c | tr -d ' ') + 1 ))
other=$(( $(echo "$moved" | grep -c .) - headlineCount ))

if [[ -n "${SUBJECT:-}" ]]; then subject="$SUBJECT"
elif [[ "$BUMP_MODE" == named ]]; then
  if [[ -z "$headline" ]]; then subject="chore(deps): refresh ${(j:, :)names} in range"
  else subject="chore(deps): $headline"; fi
  (( other > 0 )) && subject="$subject (+$other transitive)"
elif [[ "$BUMP_MODE" == remove ]]; then
  subject="chore(deps): remove the unused ${(j:, :)names} dependency"
elif [[ "$BUMP_MODE" == plus ]]; then
  subject="chore(deps): @koehler8/cms $(v @koehler8/cms "$B") -> $(v @koehler8/cms)"
  [[ -n "$headline" ]] && subject="$subject + $headline"
elif [[ "$only_cms" == yes ]]; then subject="chore(deps): @koehler8/cms $(v @koehler8/cms "$B") -> $(v @koehler8/cms)"
elif [[ "$(v @koehler8/cms "$B")" == "$(v @koehler8/cms)" ]]; then subject="chore(deps): in-range refresh (vite $(v vite), vue $(v vue))"
else subject="chore(deps): bump @koehler8/cms to $(v @koehler8/cms) + in-range refresh"; fi

pages=$(echo "$L" | jq -r .pages); theme=$(echo "$L" | jq -r .theme); rss=$(echo "$L" | jq -r .peakRssMb)
checks=$(echo "$L" | jq -r .checks); audit=$(echo "$L" | jq -c .audit)
toolchain="Node stays $(cat .nvmrc 2>/dev/null)"
scope="Dependency versions only; $toolchain. No visible change."
[[ "$only_cms" == yes ]] && scope="Framework release only: exactly one lockfile entry moved (asserted by the driver's CMS_ONLY gate). $toolchain."
if [[ "$BUMP_MODE" == named ]]; then
  scope="Transitive packages only, by name: ${(j:, :)names}. Every lockfile entry that changed is one of those or a dependency of one, and package.json is untouched (asserted by the driver's NAMED_ONLY gate); @koehler8/cms stays $(v @koehler8/cms). $toolchain. No visible change."
elif [[ "$BUMP_MODE" == remove ]]; then
  scope="Uninstall only: ${(j:, :)names}. Nothing was added and no surviving package moved version — every removed lockfile entry was reachable from the uninstalled package in the pre-removal tree, peers included (asserted by the driver's REMOVE_PKG gate). $toolchain."
elif [[ "$BUMP_MODE" == plus ]]; then
  scope="Framework release plus the companions it brings with it: ${(j:, :)names}. Every lockfile entry that changed is cms, one of those, or a dependency of one; exactly one copy of pinia in the tree and every declared pinia peer satisfied (asserted by the driver's CMS_PLUS gate). $toolchain."
fi

# before the push, so the post-push verify-live run can prove the build changed
"$HERE/verify-live.sh" "$SITE" snapshot >/dev/null 2>&1 || echo "$SITE: (no live snapshot — verify-live will rely on the Amplify job alone)"

# the removal gate makes a STRONGER claim than the bump gate's frozen list, and
# saying "the wallet libs did not move" about a commit that deleted them is a lie
if [[ "$BUMP_MODE" == remove ]]; then
  integrity='- check-site-lockfile clean; npm ls valid; zero EBADENGINE; overrides
  unchanged. Every changed lockfile entry is a removal or a flag-only
  change: nothing was added and no surviving package moved version.'
else
  integrity='- check-site-lockfile clean; npm ls valid; zero EBADENGINE; overrides
  unchanged; frozen packages (pinia, @unhead/vue, vite-ssg, extensions,
  themes, wallet + chart libs) did not move.'
fi

pagesNote=""
if [[ "$(echo "$L" | jq -r '.pagesDiffer // false')" == true ]]; then
  pagesNote="The built pages DO change here, deliberately: $(echo "$L" | jq -r '.pageDiffReason'). The
diff was printed and reviewed rather than gated on."
fi

git add package.json package-lock.json
[[ -n "$(git status --short -- vite.config.js)" ]] && git add vite.config.js
git commit -q -F - <<EOF
$subject

$scope

$moved

Gated by cms tools/fleet/bump-site.sh before this commit:
$integrity
- Amplify rehearsal in a clean copy: \`npm install --prefer-offline\`
  leaves the lockfile byte-identical, \`npm ci\` passes, a linux-x64
  install materialises both native bindings.
- Built as amplify.yml builds it, before and after: $pages pages compared
  on route list, SEO head, structure and text; theme unchanged ($theme CSS
  custom-property declarations); peak RSS ${rss} MB; acceptance checks
  green: $checks.
${pagesNote:+$pagesNote
}
- npm audit after: $audit
${NOTE:+
$NOTE
}
Rollback: git revert this commit and push.
${COMMIT_TRAILER:+
$COMMIT_TRAILER}
EOF

push_or_report
