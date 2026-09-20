#!/bin/zsh
# node-site.sh — take ONE consumer site through a Node version move, gated.
#
#   tools/fleet/node-site.sh <site-dir-name> [all|pre|baseline|switch|install|rehearse|after|restore]
#
# The sibling of bump-site.sh for the opposite kind of change: there the
# dependencies move and Node stands still; here Node moves and NOTHING ELSE MAY.
# The only files this script edits are `.nvmrc` and the one `nvm install … &&
# nvm use …` line in `amplify.yml`. package.json and package-lock.json must come
# out byte-identical — a lockfile that wants to change under the new npm is a
# finding to stop on, never something to commit.
#
# It never commits and never pushes. It exits non-zero at the first failed gate,
# and in `all` mode a failure after the switch restores `.nvmrc` + `amplify.yml`
# so the site is left exactly as it was found.
#
# Environment:
#   NODE_PIN    the Node version to land on            (default: 22.23.2)
#   NPM_PIN     glob the new Node's npm must match      (default: 10.9.*)
#   NODE_FROM   what the site must be on today          (default: 20.19.0)
#   NPM_FROM    glob for the old Node's npm             (default: 10.8.*)
#   FLEET_ROOT / FLEET_SCRATCH / IGNORE_PR_BRANCHES / ALLOW_BM_BRANCHES — as bump-site.sh
#
# NODE_PIN == NODE_FROM is a supported no-op (the proof run for this tooling):
# nothing is edited, both builds run on the same Node, every gate still runs.
#
# Facts this script leans on, each measured 2026-09-19 (Node 20.19.0 → 22.23.2):
#   - npm 10.9.8 leaves an npm-10.8-written lockfile byte-identical, for a no-op
#     install, `npm ci`, AND a targeted write. Re-proved per site in `rehearse`.
#   - amplify.yml caches node_modules/**, so the FIRST build on the new Node runs
#     on a tree installed under the old one. That is only safe because every
#     native binary in a site tree is N-API (canvas 3.x, sharp, rolldown,
#     lightningcss) and so is not tied to a Node ABI. `install` asserts that per
#     site instead of assuming it, and replays the site's preBuild steps on the
#     old tree under the new Node before reinstalling.
#   - A Node-only change can leave every asset byte-identical, so "the bundle
#     changed" cannot prove the deploy. verify-live.sh reads the Amplify build
#     log for `Now using node v<pin>` instead (NODE_WANT=<pin>).

set -u
SITE="${1:?usage: node-site.sh <site-dir-name> [phase]}"
PHASE="${2:-all}"
HERE="${0:A:h}"
CMS_REPO="${HERE:h:h}"
ROOT="${FLEET_ROOT:-${CMS_REPO:h}}"
S="${FLEET_SCRATCH:-${TMPDIR:-/tmp}/fleet-bump}"
NODE_PIN="${NODE_PIN:-22.23.2}"
NPM_PIN="${NPM_PIN:-10.9.*}"
NODE_FROM="${NODE_FROM:-20.19.0}"
NPM_FROM="${NPM_FROM:-10.8.*}"
LEDGER="$S/ledger.jsonl"
mkdir -p "$S"
cd "$ROOT/$SITE" || { echo "no such site: $ROOT/$SITE"; exit 2; }

source ~/.nvm/nvm.sh >/dev/null 2>&1
# a site build must never publish anything (site-bang submits to IndexNow in prod)
export INDEXNOW_DRY_RUN=1

fail() { echo "GATE FAILED [$SITE/$CURRENT]: $*"; exit 1; }
html_count() { find "$1" -name '*.html' | wc -l | tr -d ' '; }
amplify_line() { echo "- nvm install $1 && nvm use $1"; }
has_amplify_line() { sed 's/^ *//' amplify.yml | grep -Fxq -- "$(amplify_line "$1")"; }

use_node() { # $1 = version, $2 = npm glob
  nvm use "$1" >/dev/null 2>&1 || fail "nvm has no Node $1 installed (nvm install $1 — side by side, leave the default alias alone)"
  local n=$(node -v) m=$(npm -v)
  [[ "$n" == "v$1" && "$m" == ${~2} ]] || fail "node $n / npm $m — need v$1 / $2"
}

# package.json and the lockfile are the one thing this track must never move.
assert_deps_untouched() {
  git diff --quiet HEAD -- package.json package-lock.json || fail "package.json / package-lock.json CHANGED ($1) — stop: that is a finding, not something to commit"
}

# Same as bump-site.sh: replay amplify.yml's preBuild `npm run` steps, skip fetch:*.
prebuild_steps() {
  awk '/preBuild:/{p=1;next} /^    build:/{p=0} p' amplify.yml 2>/dev/null \
    | sed -n 's/^ *- *npm run \([A-Za-z0-9:_-]*\).*$/\1/p' | grep -v '^fetch:'
}

run_prebuild() { # $1 = label
  for step in $(prebuild_steps); do
    npm run -s "$step" >> "$S/$SITE-node-prebuild-$1.log" 2>&1 || fail "preBuild step failed: npm run $step ($1; see $S/$SITE-node-prebuild-$1.log)"
  done
}

timed_build() { # $1 = label (before|after)
  local log="$S/$SITE-node-build-$1.log"
  : > "$S/$SITE-node-prebuild-$1.log"
  run_prebuild "$1"
  /usr/bin/time -l npm run -s build:ssg > "$log" 2>&1 || { tail -20 "$log"; fail "build:ssg failed ($1)"; }
  RSS_MB=$(grep "maximum resident set size" "$log" | awk '{printf "%.0f", $1/1048576}')
  WALL=$(grep -E "^ +[0-9.]+ real" "$log" | awk '{print $1}')
  rm -rf "$S/$SITE-node-dist-$1" && cp -R dist "$S/$SITE-node-dist-$1"
  echo "  build($1): node $(node -v) html=$(html_count dist) wall=${WALL}s peakRSS=${RSS_MB}MB steps=[$(prebuild_steps | tr '\n' ' ')]"
}

phase_pre() {
  use_node "$NODE_FROM" "$NPM_FROM"
  git pull --ff-only >/dev/null 2>&1 || fail "git pull --ff-only failed"
  local dirty=$(git status --short | wc -l | tr -d ' ')
  [[ "$dirty" == 0 ]] || { git status --short | head -5; fail "working tree is not clean ($dirty files) — someone is working here"; }
  [[ "$(cat .nvmrc 2>/dev/null)" == "$NODE_FROM" ]] || fail ".nvmrc is '$(cat .nvmrc 2>/dev/null)', expected $NODE_FROM"
  # exactly one nvm line, and it is the fleet-standard one — anything else is a
  # site that needs a human, not a sed
  [[ "$(grep -c 'nvm ' amplify.yml)" == 1 ]] || fail "amplify.yml has $(grep -c 'nvm ' amplify.yml) nvm lines, expected exactly 1"
  has_amplify_line "$NODE_FROM" || fail "amplify.yml's nvm line is not the standard '$(amplify_line "$NODE_FROM")'"
  # engines must already admit the target, because package.json may not change
  node -e '
    const e = require("./package.json").engines || {};
    const [pin] = process.argv.slice(1);
    const ge = (a, b) => { a = a.split(".").map(Number); b = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return true; };
    const m = /^>=\s*(\d+\.\d+\.\d+)$/.exec(e.node || ">=0.0.0");
    if (!m || !ge(pin, m[1])) { console.error(`engines.node "${e.node}" is not a plain floor that admits ${pin}`); process.exit(1); }
  ' "$NODE_PIN" || fail "package.json engines does not admit Node $NODE_PIN — and this track may not edit package.json"
  local repo="koehler8/$SITE"
  local prs=$(gh pr list --repo "$repo" --state open --json headRefName,number,files 2>/dev/null \
    | jq -r --arg ignore " ${IGNORE_PR_BRANCHES:-} " \
      '.[] | .headRefName as $head
           | ([.files[].path] | any(. == "package.json" or . == "package-lock.json" or . == ".nvmrc" or . == "amplify.yml")) as $collides
           | select((($ignore | contains(" " + $head + " ")) and ($collides | not)) | not)
           | "#\(.number) \($head)"' | tr '\n' ' ')
  [[ -z "$prs" ]] || fail "open PR(s) on $repo: $prs"
  local bmHeads=($(git ls-remote --heads origin 'bm/*' 2>/dev/null | awk '{print $2}' | sed 's#refs/heads/##'))
  if (( ${#bmHeads} > 0 )); then
    [[ -n "${ALLOW_BM_BRANCHES:-}" ]] || fail "${#bmHeads} in-flight buildmill branch(es) on origin (inspect them; ALLOW_BM_BRANCHES=1 if none touches .nvmrc / amplify.yml)"
    git fetch -q origin 'refs/heads/bm/*:refs/remotes/origin/bm/*' 2>/dev/null
    for head in $bmHeads; do
      git diff --name-only "origin/main...origin/$head" 2>/dev/null | grep -qxE '\.nvmrc|amplify\.yml' \
        && fail "buildmill branch $head changes .nvmrc or amplify.yml — this move would conflict with it"
    done
  fi
  node "$CMS_REPO/scripts/check-site-lockfile.mjs" . >/dev/null || fail "the CURRENT lockfile already fails check-site-lockfile"
  npm ci --no-audit --no-fund >/dev/null 2>&1 || fail "npm ci failed on the current lockfile under Node $NODE_FROM"
  assert_deps_untouched "npm ci under $NODE_FROM"
  echo "  pre: clean, in sync with origin ($(git rev-parse --short HEAD)), no PRs, .nvmrc + amplify.yml on $NODE_FROM, engines admits $NODE_PIN"
}

phase_baseline() { use_node "$NODE_FROM" "$NPM_FROM"; timed_build before; }

phase_switch() {
  if [[ "$NODE_PIN" == "$NODE_FROM" ]]; then echo "  switch: NODE_PIN == NODE_FROM ($NODE_PIN) — no-op run, nothing edited"; return 0; fi
  printf '%s\n' "$NODE_PIN" > .nvmrc
  # the two versions on that one line, nothing else in the file
  sed -i '' "s/nvm install ${NODE_FROM//./\\.} && nvm use ${NODE_FROM//./\\.}/nvm install $NODE_PIN \&\& nvm use $NODE_PIN/" amplify.yml
  local changed=$(git status --short | awk '{print $2}' | sort | tr '\n' ' ')
  [[ "$changed" == ".nvmrc amplify.yml " ]] || fail "unexpected files changed: [$changed]"
  [[ "$(git diff --numstat -- .nvmrc | awk '{print $1"/"$2}')" == "1/1" ]] || fail ".nvmrc diff is not exactly one line"
  [[ "$(git diff --numstat -- amplify.yml | awk '{print $1"/"$2}')" == "1/1" ]] || fail "amplify.yml diff is not exactly one line"
  has_amplify_line "$NODE_PIN" || fail "amplify.yml does not carry '$(amplify_line "$NODE_PIN")' after the edit"
  grep -q "$NODE_FROM" .nvmrc amplify.yml && fail "$NODE_FROM still appears in .nvmrc / amplify.yml"
  echo "  switch: .nvmrc + the one amplify.yml line -> $NODE_PIN (1 line each, nothing else)"
}

phase_install() {
  use_node "$NODE_PIN" "$NPM_PIN"
  # 1. What Amplify's FIRST build on the new Node really does: its cache restores
  #    a node_modules installed under the old Node, `npm install` is then a no-op,
  #    and the preBuild steps (the canvas / sharp users) run on that old tree.
  npm install --prefer-offline --no-audit --no-fund >/dev/null 2>&1 || fail "Amplify's install command failed on the old-Node tree under $NODE_PIN"
  assert_deps_untouched "npm install on the cached tree under $NODE_PIN"
  : > "$S/$SITE-node-prebuild-stale.log"
  run_prebuild stale
  # 2. Then the clean state: a tree installed under the new Node.
  rm -rf node_modules
  npm ci --no-audit --no-fund > "$S/$SITE-node-ci.log" 2>&1 || { tail -12 "$S/$SITE-node-ci.log"; fail "npm ci failed under Node $NODE_PIN"; }
  assert_deps_untouched "npm ci under $NODE_PIN"
  local eb=$(grep -c 'EBADENGINE' "$S/$SITE-node-ci.log")
  [[ "$eb" == 0 ]] || { grep -A3 EBADENGINE "$S/$SITE-node-ci.log" | head -8; fail "$eb EBADENGINE warning(s) under Node $NODE_PIN"; }
  npm ls >/dev/null 2>&1 || fail "npm ls reports an invalid tree under Node $NODE_PIN"
  # 3. Every native binary must be N-API. One tied to a Node ABI would be the
  #    thing that breaks on Amplify's cached tree and nowhere else.
  NATIVE=0
  local bound=()
  for f in $(find node_modules -name '*.node' 2>/dev/null); do
    NATIVE=$((NATIVE+1))
    nm -gU "$f" 2>/dev/null | grep -q 'node_register_module_v' && bound+=("${f#node_modules/}")
  done
  (( ${#bound} == 0 )) || fail "ABI-bound native module(s) — Amplify's cached node_modules would carry the old-Node build: $bound"
  # 4. ...and the ones a site build imports must actually load.
  for m in canvas sharp; do
    [[ -d "node_modules/$m" ]] || continue
    node -e "require('$m')" >/dev/null 2>&1 || fail "native module '$m' does not load under Node $NODE_PIN"
  done
  echo "  install: cached-tree preBuild ok under $NODE_PIN; npm ci ok; lockfile + package.json untouched; 0 EBADENGINE; $NATIVE native binaries, all N-API, canvas/sharp load"
}

phase_rehearse() {
  use_node "$NODE_PIN" "$NPM_PIN"
  local R="$S/$SITE-node-amplify"
  rm -rf "$R" && mkdir -p "$R" && git ls-files | cpio -pdm "$R" 2>/dev/null
  cp .nvmrc amplify.yml "$R"/
  ( cd "$R"
    npm install --prefer-offline --no-audit --no-fund >/dev/null 2>&1 || exit 11
    cmp -s package-lock.json "$ROOT/$SITE/package-lock.json" || exit 12
    cmp -s package.json "$ROOT/$SITE/package.json" || exit 12
    rm -rf node_modules && npm ci --os=linux --cpu=x64 --no-audit --no-fund >/dev/null 2>&1 || exit 14
    [[ -d node_modules/@rolldown/binding-linux-x64-gnu && -d node_modules/@img/sharp-linux-x64 ]] || exit 15
  )
  local rc=$?
  rm -rf "$R"
  case $rc in
    0) echo "  rehearse: under npm $(npm -v), Amplify's install leaves lockfile + package.json byte-identical; linux-x64 bindings materialise" ;;
    11) fail "Amplify's install command failed in a clean copy under Node $NODE_PIN" ;;
    12) fail "npm $(npm -v) REWRITES the lockfile / package.json — stop and characterise the diff" ;;
    14) fail "linux-x64 npm ci failed under Node $NODE_PIN" ;;
    15) fail "linux-x64 native bindings did not materialise" ;;
    *) fail "rehearsal failed ($rc)" ;;
  esac
}

phase_after() {
  use_node "$NODE_PIN" "$NPM_PIN"
  timed_build after
  assert_deps_untouched "build under $NODE_PIN"
  local hb=$(html_count "$S/$SITE-node-dist-before") ha=$(html_count "$S/$SITE-node-dist-after")
  [[ "$hb" == "$ha" && "$ha" != 0 ]] || fail "HTML count $hb -> $ha (a partial SSG failure reads as missing routes)"
  node "$CMS_REPO/scripts/diff-ssg-dist.mjs" "$S/$SITE-node-dist-before" "$S/$SITE-node-dist-after" > "$S/$SITE-node-diff.log" 2>&1 \
    || { head -24 "$S/$SITE-node-diff.log"; fail "diff-ssg-dist found differences (full log: $S/$SITE-node-diff.log)"; }
  thin() { (cd "$1" && find . -name '*.html' -size -4k | sort); }
  diff <(thin "$S/$SITE-node-dist-before") <(thin "$S/$SITE-node-dist-after") >/dev/null || fail "the set of near-empty pages changed"
  node "$CMS_REPO/scripts/check-site-lockfile.mjs" . >/dev/null || fail "check-site-lockfile"
  local changed=$(git status --short | awk '{print $2}' | sort | tr '\n' ' ')
  local want=".nvmrc amplify.yml "; [[ "$NODE_PIN" == "$NODE_FROM" ]] && want=""
  [[ "$changed" == "$want" ]] || fail "tree should differ from HEAD in exactly [$want], found [$changed]"
  local checks=0
  for c in builder/checks/*.check.mjs(N); do
    node "$c" >/dev/null 2>&1 || { node "$c" | grep -i fail | head -5; fail "acceptance check $c is red"; }
    checks=$((checks+1))
  done
  for sc in builder/scanners/token-surface.mjs(N) builder/scanners/canon-tripwires.mjs(N); do
    [[ "$(node "$sc" 2>/dev/null | tr -d ' \n')" == "[]" ]] || fail "scanner $sc reports findings"
  done
  # Informational, never a gate. Two facts about the raw bytes:
  #  - is the set of hashed asset NAMES the same? If so, production's bundles will
  #    not change when this deploys, and only the build log can prove it landed.
  #  - how many files differ at all? Not zero even on ONE Node: vite-ssg renders
  #    pages concurrently, so the order of a page's preload hints in <head> varies
  #    from build to build (site-erea: 3 of 62 pages, measured 20.19.0 vs itself).
  #    That is the noise floor — diff-ssg-dist above is what judges the pages.
  local assets=$(diff <(cd "$S/$SITE-node-dist-before" && find . -path './assets/*' | sort) <(cd "$S/$SITE-node-dist-after" && find . -path './assets/*' | sort) >/dev/null 2>&1 && echo same || echo CHANGED)
  local nd=$(diff -rq "$S/$SITE-node-dist-before" "$S/$SITE-node-dist-after" 2>/dev/null | wc -l | tr -d ' ')
  local theme=$(grep -o 'theme fingerprint: [0-9]*' "$S/$SITE-node-diff.log" | grep -o '[0-9]*$')
  local rss_before=$(grep "maximum resident set size" "$S/$SITE-node-build-before.log" | awk '{printf "%.0f", $1/1048576}')
  local wall_before=$(grep -E "^ +[0-9.]+ real" "$S/$SITE-node-build-before.log" | awk '{print $1}')
  echo "  after: $ha pages identical, theme unchanged ($theme declarations), checks green=$checks, peakRSS ${rss_before}->${RSS_MB}MB, wall ${wall_before}->${WALL}s, hashed assets $assets, $nd file(s) differ in bytes"
  jq -nc --arg site "$SITE" --arg from "$NODE_FROM" --arg to "$NODE_PIN" --arg npm "$(npm -v)" \
     --argjson pages "$ha" --argjson theme "${theme:-0}" --argjson rssBefore "${rss_before:-0}" --argjson rss "${RSS_MB:-0}" \
     --argjson checks "$checks" --argjson native "${NATIVE:-0}" --arg assets "$assets" --argjson nd "${nd:-0}" --arg at "$(date -u +%FT%TZ)" \
     '{site:$site,track:"node",result:"READY",nodeFrom:$from,node:$to,npm:$npm,pages:$pages,theme:$theme,peakRssMbBefore:$rssBefore,peakRssMb:$rss,checks:$checks,nativeBinaries:$native,hashedAssets:$assets,filesDifferingInBytes:$nd,at:$at}' >> "$LEDGER"
}

phase_restore() {
  git checkout HEAD -- .nvmrc amplify.yml 2>/dev/null
  echo "  restored .nvmrc + amplify.yml to HEAD (node_modules may be from either Node — the next run's npm ci resyncs it)"
}

run() { CURRENT="$1"; "phase_$1"; }

if [[ "$PHASE" == all ]]; then
  echo "== $SITE  (Node $NODE_FROM -> $NODE_PIN)"
  SWITCHED=0
  trap '[[ $? -ne 0 && $SWITCHED == 1 ]] && { echo "  -> leaving the site untouched"; phase_restore; jq -nc --arg site "$SITE" --arg at "$(date -u +%FT%TZ)" "{site:\$site,track:\"node\",result:\"FAILED\",at:\$at}" >> "$LEDGER"; }' EXIT
  run pre; run baseline; SWITCHED=1; run switch; run install; run rehearse; run after
  SWITCHED=0
  echo "  READY — all gates green; review, then SHIP_MODE=node ship-site.sh"
else
  run "$PHASE"
fi
