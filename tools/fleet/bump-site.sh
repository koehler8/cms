#!/bin/zsh
# bump-site.sh — take ONE consumer site through the fleet dependency bump, gated.
#
#   tools/fleet/bump-site.sh <site-dir-name> [all|pre|baseline|bump|gates|rehearse|after|restore]
#
# It never commits and never pushes. It exits non-zero at the first failed gate,
# and in `all` mode a failure after the bump restores package.json and
# package-lock.json so the site is left exactly as it was found.
#
# Why this exists: consumer sites have no test suite — a green build:ssg is their
# only gate, and it cannot see a lockfile stripped of the Linux binaries Amplify
# needs, a component that silently stopped rendering, or a theme regression. This
# is the recipe proven by hand on site-erea, site-vor, site-poopee and
# site-coastalcollective (2026-09-19), made repeatable. It lives under tools/,
# which is NOT in package.json `files`, so it never ships to npm.
#
# Environment:
#   FLEET_ROOT     directory holding the site-* repos   (default: parent of this repo)
#   FLEET_SCRATCH  where builds, logs and the ledger go (default: $TMPDIR/fleet-bump)
#   CMS_TARGET     @koehler8/cms version to land on     (default: 1.3.0)
#   CMS_ONLY=1     framework-release pass: move cms and assert NOTHING else did
#   EXACT_TARGETS  "vite@8.3.0 vue@3.5.43" for a site that pins without a caret
#   IGNORE_PR_BRANCHES / ALLOW_BM_BRANCHES=1   explicit, narrow pre-flight excuses
#   NODE_PIN / NPM_PIN   the toolchain every phase asserts (default: 20.19.0 / 10.8.*).
#                  The site's .nvmrc must agree — a site that has moved to another
#                  Node fails `pre` loudly until the operator names it. Moving a
#                  site's Node is node-site.sh's job, never this script's.

set -u
SITE="${1:?usage: bump-site.sh <site-dir-name> [phase]}"
PHASE="${2:-all}"
HERE="${0:A:h}"
CMS_REPO="${HERE:h:h}"
ROOT="${FLEET_ROOT:-${CMS_REPO:h}}"
S="${FLEET_SCRATCH:-${TMPDIR:-/tmp}/fleet-bump}"
CMS_TARGET="${CMS_TARGET:-1.3.0}"
NODE_PIN="${NODE_PIN:-20.19.0}"
NPM_PIN="${NPM_PIN:-10.8.*}"
LEDGER="$S/ledger.jsonl"
mkdir -p "$S"
cd "$ROOT/$SITE" || { echo "no such site: $ROOT/$SITE"; exit 2; }

# The in-range refresh. Direct deps first, then the transitive packages npm audit
# flags on every site; CRYPTO_TREE is added only where that tree is installed.
DIRECT=(vite vue vue-router @vitejs/plugin-vue)
TRANSITIVE=(fast-uri nanoid postcss sharp undici)
CRYPTO_TREE=(axios ws form-data)
# Must not move: a second copy or a new major of any of these is a runtime bug
# the build will not show. Absent packages are skipped.
FROZEN=(pinia @unhead/vue vite-ssg @koehler8/cms-ext-compliance @koehler8/cms-ext-crypto
        @koehler8/cms-theme-frog @koehler8/cms-theme-swamp ethers @reown/appkit chart.js vue-chartjs)

source ~/.nvm/nvm.sh >/dev/null 2>&1
nvm use "$NODE_PIN" >/dev/null 2>&1
# a site build must never publish anything (site-bang submits to IndexNow in prod)
export INDEXNOW_DRY_RUN=1

fail() { echo "GATE FAILED [$SITE/$CURRENT]: $*"; exit 1; }
ver()  { jq -r --arg k "node_modules/$1" '.packages[$k].version // "-"' "${2:-package-lock.json}"; }
html_count() { find "$1" -name '*.html' | wc -l | tr -d ' '; }

assert_toolchain() {
  local n=$(node -v) m=$(npm -v)
  [[ "$n" == "v$NODE_PIN" && "$m" == ${~NPM_PIN} ]] || fail "node $n / npm $m — need v$NODE_PIN / $NPM_PIN"
  [[ "$(cat .nvmrc 2>/dev/null)" == "$NODE_PIN" ]] || fail ".nvmrc pins '$(cat .nvmrc 2>/dev/null)' but this run is pinned to $NODE_PIN — set NODE_PIN / NPM_PIN to match the site"
}

# The `npm run` steps amplify.yml's preBuild performs, in order — so a site's own
# favicon / brand-icon generation runs here exactly where it runs on Amplify.
# Network fetches (fetch:*) are skipped on purpose: they rewrite tracked content
# from a live feed, which would dirty the tree and make before/after differ for
# reasons that have nothing to do with dependencies.
prebuild_steps() {
  awk '/preBuild:/{p=1;next} /^    build:/{p=0} p' amplify.yml 2>/dev/null \
    | sed -n 's/^ *- *npm run \([A-Za-z0-9:_-]*\).*$/\1/p' | grep -v '^fetch:'
}

timed_build() { # $1 = label (before|after)
  local log="$S/$SITE-build-$1.log"
  for step in $(prebuild_steps); do
    npm run -s "$step" >> "$S/$SITE-prebuild-$1.log" 2>&1 || fail "preBuild step failed: npm run $step (see $S/$SITE-prebuild-$1.log)"
  done
  /usr/bin/time -l npm run -s build:ssg > "$log" 2>&1 || { tail -20 "$log"; fail "build:ssg failed ($1)"; }
  RSS_MB=$(grep "maximum resident set size" "$log" | awk '{printf "%.0f", $1/1048576}')
  WALL=$(grep -E "^ +[0-9.]+ real" "$log" | awk '{print $1}')
  rm -rf "$S/$SITE-dist-$1" && cp -R dist "$S/$SITE-dist-$1"
  echo "  build($1): html=$(html_count dist) wall=${WALL}s peakRSS=${RSS_MB}MB steps=[$(prebuild_steps | tr '\n' ' ')]"
}

phase_pre() {
  assert_toolchain
  git pull --ff-only >/dev/null 2>&1 || fail "git pull --ff-only failed"
  local dirty=$(git status --short | wc -l | tr -d ' ')
  [[ "$dirty" == 0 ]] || { git status --short | head -5; fail "working tree is not clean ($dirty files) — someone is working here"; }
  local repo="koehler8/$SITE"
  # An open PR means someone else may be about to change this repo. A PR the
  # operator has looked at and judged irrelevant (a stale one that touches no
  # dependency file) is excused BY BRANCH NAME, one at a time:
  #   IGNORE_PR_BRANCHES="autonomy/issue-720"
  # and even then never if it touches package.json or the lockfile.
  local prs=$(gh pr list --repo "$repo" --state open --json headRefName,number,files 2>/dev/null \
    | jq -r --arg ignore " ${IGNORE_PR_BRANCHES:-} " \
      '.[] | .headRefName as $head
           | ([.files[].path] | any(. == "package.json" or . == "package-lock.json")) as $touchesDeps
           | select((($ignore | contains(" " + $head + " ")) and ($touchesDeps | not)) | not)
           | "#\(.number) \($head)"' | tr '\n' ' ')
  [[ -z "$prs" ]] || fail "open PR(s) on $repo: $prs"
  # bm/<itemId> heads are buildmill's interim pushes for items in flight. By
  # default ANY of them stops the run. A paused product leaves them lying around
  # (site-bang had six), so ALLOW_BM_BRANCHES=1 narrows the rule to what actually
  # collides: a branch that changes package-lock.json would hit an unmergeable
  # conflict against this bump. One that does not is left alone and can rebase.
  local bmHeads=($(git ls-remote --heads origin 'bm/*' 2>/dev/null | awk '{print $2}' | sed 's#refs/heads/##'))
  if (( ${#bmHeads} > 0 )); then
    [[ -n "${ALLOW_BM_BRANCHES:-}" ]] || fail "${#bmHeads} in-flight buildmill branch(es) on origin (inspect them; ALLOW_BM_BRANCHES=1 if none touches the lockfile)"
    git fetch -q origin 'refs/heads/bm/*:refs/remotes/origin/bm/*' 2>/dev/null
    for head in $bmHeads; do
      git diff --name-only "origin/main...origin/$head" 2>/dev/null | grep -qx 'package-lock.json' \
        && fail "buildmill branch $head changes package-lock.json — this bump would strand it on an unmergeable conflict"
    done
  fi
  node "$CMS_REPO/scripts/check-site-lockfile.mjs" . >/dev/null || fail "the CURRENT lockfile already fails check-site-lockfile"
  # node_modules must match the lockfile or `npm update` plans against the wrong tree
  npm ci --no-audit --no-fund >/dev/null 2>&1 || fail "npm ci failed on the current lockfile"
  echo "  pre: clean, in sync with origin ($(git rev-parse --short HEAD)), no PRs, cms $(ver @koehler8/cms), vite $(ver vite)"
}

phase_baseline() { assert_toolchain; timed_build before; }

phase_bump() {
  assert_toolchain
  cp package-lock.json "$S/$SITE-lock-before.json"
  if [[ "$(ver @koehler8/cms)" != "$CMS_TARGET" ]]; then
    npm install "@koehler8/cms@$CMS_TARGET" --no-audit --no-fund >/dev/null 2>&1 || fail "npm install @koehler8/cms@$CMS_TARGET failed"
  fi
  # CMS_ONLY=1 — a framework-release pass. Nothing but cms may move, and that is
  # ENFORCED, not hoped for: a patch release of anything else landing mid-pass
  # must not ride along on a commit that says "cms 1.3.0 -> 1.3.1". Valid only
  # when the release left cms's own dependencies / peerDependencies alone (check
  # `git diff vA vB -- package.json` in this repo first); then a site's lockfile
  # changes in exactly two entries — the root (its declared range) and cms.
  if [[ -n "${CMS_ONLY:-}" ]]; then
    assert_toolchain
    [[ "$(ver @koehler8/cms)" == "$CMS_TARGET" ]] || fail "@koehler8/cms is $(ver @koehler8/cms), expected $CMS_TARGET"
    local drift=$(jq -rn --slurpfile a "$S/$SITE-lock-before.json" --slurpfile b package-lock.json '
      ($a[0].packages) as $x | ($b[0].packages) as $y
      | [ (($x | keys) + ($y | keys) | unique)[]
          | select(. != "" and . != "node_modules/@koehler8/cms")
          | select(($x[.] // null) != ($y[.] // null)) ]
      | join(" ")')
    [[ -z "$drift" ]] || fail "CMS_ONLY: other lockfile entries changed: ${drift:0:300}"
    local a=$(ver @koehler8/cms "$S/$SITE-lock-before.json")
    MOVED="@koehler8/cms $a->$(ver @koehler8/cms) (the only lockfile entry that moved)"
    [[ "$a" == "$CMS_TARGET" ]] && MOVED="nothing (already on $CMS_TARGET)"
    echo "  bump: $MOVED"
    return 0
  fi
  # A site that pins a direct dep EXACTLY (no caret — site-buildmill does, for
  # vite and vue) is invisible to `npm update`. Its targets are named by the
  # operator, never guessed: EXACT_TARGETS="vite@8.3.0 vue@3.5.43". The exact
  # style is preserved.
  if [[ -n "${EXACT_TARGETS:-}" ]]; then
    npm install ${=EXACT_TARGETS} --save-exact --no-audit --no-fund >/dev/null 2>&1 || fail "npm install --save-exact $EXACT_TARGETS failed"
    for spec in ${=EXACT_TARGETS}; do
      local name="${spec%@*}" want="${spec##*@}"
      [[ "$(ver $name)" == "$want" ]] || fail "$name is $(ver $name), expected exactly $want"
      [[ "$(jq -r --arg n "$name" '.dependencies[$n] // .devDependencies[$n]' package.json)" == "$want" ]] || fail "$name lost its exact-pin style in package.json"
    done
  fi
  assert_toolchain
  local names=($DIRECT $TRANSITIVE)
  [[ "$(ver axios)" != "-" || "$(ver ws)" != "-" ]] && names+=($CRYPTO_TREE)
  npm update $names --no-audit --no-fund >/dev/null 2>&1 || fail "npm update failed"
  [[ "$(ver @koehler8/cms)" == "$CMS_TARGET" ]] || fail "@koehler8/cms is $(ver @koehler8/cms), expected $CMS_TARGET"
  # `npm update` can report success and move nothing (it does in the cms repo), so
  # believe the registry, not the exit code: nothing we own may still be outdated.
  # @koehler8/cms is NOT in this list — it is pinned to CMS_TARGET on purpose and
  # asserted just above. A newer cms being published mid-rollout (1.3.1 landed
  # during the 1.3.0 fan-out) must not fail a site that landed exactly on target:
  # which framework release the fleet moves to is a decision, not drift.
  local stale=$(npm outdated --json 2>/dev/null | jq -r --argjson d "$(printf '%s\n' $DIRECT | jq -R . | jq -s .)" \
    'to_entries[] | select(.key as $k | $d | index($k)) | select(.value.current != .value.wanted) | "\(.key) \(.value.current)->\(.value.wanted)"' | tr '\n' ' ')
  [[ -z "$stale" ]] || fail "did not move: $stale"
  for p in $FROZEN; do
    local a=$(ver $p "$S/$SITE-lock-before.json") b=$(ver $p)
    [[ "$a" == "$b" ]] || fail "$p moved $a -> $b (must not move)"
  done
  MOVED=$(for p in @koehler8/cms $DIRECT rolldown $TRANSITIVE $CRYPTO_TREE; do
    a=$(ver $p "$S/$SITE-lock-before.json"); b=$(ver $p); [[ "$a" != "$b" ]] && printf "%s %s->%s, " "$p" "$a" "$b"; done)
  echo "  bump: ${MOVED%, }"
}

phase_gates() {
  local changed=$(git status --short | awk '{print $2}' | sort | tr '\n' ' ')
  # empty = the site was already current (a re-run is a no-op, not an error)
  [[ -z "$changed" || "$changed" == "package-lock.json package.json " || "$changed" == "package-lock.json " ]] || fail "unexpected files changed: $changed"
  [[ "$(jq .lockfileVersion package-lock.json)" == 3 ]] || fail "lockfileVersion is not 3"
  node "$CMS_REPO/scripts/check-site-lockfile.mjs" . >/dev/null || { node "$CMS_REPO/scripts/check-site-lockfile.mjs" .; fail "check-site-lockfile"; }
  [[ "$(git show HEAD:package.json | jq -cS .overrides)" == "$(jq -cS .overrides package.json)" ]] || fail "package.json overrides changed"
  [[ "$(jq '.packages[""] | has("overrides")' package-lock.json)" == "$(git show HEAD:package-lock.json | jq '.packages[""] | has("overrides")')" ]] || fail "an overrides block (dis)appeared in the lockfile root"
  npm ls >/dev/null 2>&1 || fail "npm ls reports an invalid tree"
  local eb=$(npm install --dry-run --no-audit --no-fund 2>&1 | grep -c 'EBADENGINE Unsupported')
  [[ "$eb" == 0 ]] || fail "$eb package(s) reject Node $NODE_PIN (EBADENGINE)"
  # No result is UNKNOWN, never zero: npm's advisory endpoint does go down.
  AUDIT=$(npm audit --json 2>/dev/null | jq -c '.metadata.vulnerabilities | {critical,high,moderate}' 2>/dev/null)
  [[ -n "$AUDIT" && "$AUDIT" != "null" ]] || AUDIT='"UNKNOWN"'
  echo "  gates: lockfile clean ($(jq '.packages|length' package-lock.json) entries), tree valid, audit=$AUDIT"
}

phase_rehearse() {
  assert_toolchain
  local R="$S/$SITE-amplify"
  rm -rf "$R" && mkdir -p "$R" && git ls-files | cpio -pdm "$R" 2>/dev/null
  cp package.json package-lock.json "$R"/
  ( cd "$R"
    npm install --prefer-offline --no-audit --no-fund >/dev/null 2>&1 || exit 11
    cmp -s package-lock.json "$ROOT/$SITE/package-lock.json" || exit 12
    rm -rf node_modules && npm ci --no-audit --no-fund >/dev/null 2>&1 || exit 13
    rm -rf node_modules && npm ci --os=linux --cpu=x64 --no-audit --no-fund >/dev/null 2>&1 || exit 14
    [[ -d node_modules/@rolldown/binding-linux-x64-gnu && -d node_modules/@img/sharp-linux-x64 ]] || exit 15
  )
  local rc=$?
  rm -rf "$R"
  case $rc in
    0) echo "  rehearse: Amplify install leaves the lockfile byte-identical; npm ci ok; linux-x64 bindings materialise" ;;
    11) fail "Amplify's install command failed in a clean copy" ;;
    12) fail "Amplify's install command REWRITES the lockfile" ;;
    13) fail "npm ci failed in a clean copy" ;;
    14) fail "linux-x64 npm ci failed" ;;
    15) fail "linux-x64 native bindings did not materialise — this is the Amplify failure" ;;
    *) fail "rehearsal failed ($rc)" ;;
  esac
}

phase_after() {
  assert_toolchain
  timed_build after
  local hb=$(html_count "$S/$SITE-dist-before") ha=$(html_count "$S/$SITE-dist-after")
  [[ "$hb" == "$ha" && "$ha" != 0 ]] || fail "HTML count $hb -> $ha (a partial SSG failure reads as missing routes)"
  node "$CMS_REPO/scripts/diff-ssg-dist.mjs" "$S/$SITE-dist-before" "$S/$SITE-dist-after" > "$S/$SITE-diff.log" 2>&1 \
    || { head -24 "$S/$SITE-diff.log"; fail "diff-ssg-dist found differences (full log: $S/$SITE-diff.log)"; }
  thin() { (cd "$1" && find . -name '*.html' -size -4k | sort); }
  diff <(thin "$S/$SITE-dist-before") <(thin "$S/$SITE-dist-after") >/dev/null || fail "the set of near-empty pages changed"
  [[ -z "$(git status --short -- vite.config.js amplify.yml)" ]] || fail "a never-touch file changed"
  local checks=0
  for c in builder/checks/*.check.mjs(N); do
    node "$c" >/dev/null 2>&1 || { node "$c" | grep -i fail | head -5; fail "acceptance check $c is red"; }
    checks=$((checks+1))
  done
  for sc in builder/scanners/token-surface.mjs(N) builder/scanners/canon-tripwires.mjs(N); do
    [[ "$(node "$sc" 2>/dev/null | tr -d ' \n')" == "[]" ]] || fail "scanner $sc reports findings"
  done
  local theme=$(grep -o 'theme fingerprint: [0-9]*' "$S/$SITE-diff.log" | grep -o '[0-9]*$')
  local rss_before=$(grep "maximum resident set size" "$S/$SITE-build-before.log" | awk '{printf "%.0f", $1/1048576}')
  echo "  after: $ha pages identical, theme unchanged ($theme declarations), checks green=$checks, peakRSS ${rss_before}->${RSS_MB}MB"
  jq -nc --arg site "$SITE" --arg cms "$(ver @koehler8/cms)" --arg vite "$(ver vite)" --arg vue "$(ver vue)" \
     --argjson pages "$ha" --argjson theme "${theme:-0}" --argjson rss "${RSS_MB:-0}" --argjson checks "$checks" \
     --argjson audit "${AUDIT:-\"UNKNOWN\"}" --arg at "$(date -u +%FT%TZ)" \
     '{site:$site,result:"READY",cms:$cms,vite:$vite,vue:$vue,pages:$pages,theme:$theme,peakRssMb:$rss,checks:$checks,audit:$audit,at:$at}' >> "$LEDGER"
}

phase_restore() {
  git checkout HEAD -- package.json package-lock.json 2>/dev/null
  echo "  restored package.json + package-lock.json to HEAD (node_modules is ahead; the next npm ci resyncs it)"
}

run() { CURRENT="$1"; "phase_$1"; }

if [[ "$PHASE" == all ]]; then
  echo "== $SITE"
  BUMPED=0
  trap '[[ $? -ne 0 && $BUMPED == 1 ]] && { echo "  -> leaving the site untouched"; phase_restore; jq -nc --arg site "$SITE" --arg at "$(date -u +%FT%TZ)" "{site:\$site,result:\"FAILED\",at:\$at}" >> "$LEDGER"; }' EXIT
  run pre; run baseline; BUMPED=1; run bump; run gates; run rehearse; run after
  BUMPED=0
  echo "  READY — all gates green; review, commit and push by hand"
else
  run "$PHASE"
fi
