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
#   CMS_TARGET     @koehler8/cms version to land on — REQUIRED, no default. A
#                  baked-in default goes stale the day the fleet moves past it:
#                  "1.3.0" outlived the 1.3.1 pass, and a default run would have
#                  DOWNGRADED a site and still reached READY. A target below the
#                  locked version is refused for the same reason.
#   CMS_ONLY=1     framework-release pass: move cms and assert NOTHING else did
#   NAMED_ONLY     "ethers viem ws" — move these transitive packages BY NAME and
#                  nothing else. CMS_TARGET is still required, but here it is an
#                  assertion (the framework must already be on it), never an
#                  install: a commit that says "ethers 6.16 -> 6.17" must not
#                  also carry a cms bump it never mentioned. Every lockfile entry
#                  that changes must be one of the names or a dependency of one.
#   CMS_PLUS       "pinia @vue/devtools-api @koehler8/cms-ext-crypto@1.0.0-beta.5"
#                  — a framework release that legitimately brings a bundled
#                  runtime dependency with it (cms 1.4.0 carries pinia 4), where
#                  CMS_ONLY's "exactly two entries moved" is the wrong invariant.
#                  A name given as name@version is INSTALLED at that version in
#                  the same npm install as cms, so peers resolve together; a bare
#                  name is allow-listed only.
#   REMOVE_PKG     "@koehler8/cms-ext-crypto" — UNINSTALL a package the site no
#                  longer uses. Gated by the uninstall rule, which is stricter
#                  than a bump's: nothing may be ADDED, no surviving version may
#                  MOVE, and every removal must have been reachable from the
#                  uninstalled package — peers INCLUDED, because npm 7+ installs
#                  peers, so a peer-only orphan is legitimately swept out.
#   EXPECT_PAGE_DIFF="<why>"  the built pages are EXPECTED to change, and the
#                  operator says in words what should change. `after` then prints
#                  the diff for review instead of failing on it, and records the
#                  reason in the ledger so the commit message carries it. Never
#                  set this to get past a diff you have not read.
#   EXACT_TARGETS  "vite@8.3.0 vue@3.5.43" for a site that pins without a caret
#   IGNORE_PR_BRANCHES / ALLOW_BM_BRANCHES=1   explicit, narrow pre-flight excuses
#   NODE_PIN / NPM_PIN   the toolchain every phase asserts (default: 22.23.2 / 10.9.* —
#                  the fleet pin since 2026-09-20; was 20.19.0 / 10.8.*).
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
CMS_TARGET="${CMS_TARGET:-}"
NODE_PIN="${NODE_PIN:-22.23.2}"
NPM_PIN="${NPM_PIN:-10.9.*}"
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

# "pinia@4.0.3" -> pinia · "@koehler8/cms-ext-crypto@1.0.0-beta.5" -> the scope+name
# · "@vue/devtools-api" -> itself. A leading scope @ is not a version separator.
# Is $1 in vite.config.js's `extensions:` array? Comments are stripped FIRST:
# site-poopee and site-peepoo carry the line
#   // Re-add '@koehler8/cms-ext-crypto' to restore the wallet-connect surfaces
# so a whole-file grep calls both of them registered when neither is. Getting
# this wrong means the driver edits a COMMENT and claims it unregistered
# something.
is_registered() {
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync("vite.config.js", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const m = src.match(/extensions\s*:\s*\[([^\]]*)\]/);
    process.exit(m && m[1].includes(process.argv[1]) ? 0 : 1);
  ' "$1"
}

spec_name() {
  local spec="$1" rest="${1#@}"
  [[ "$rest" == *@* ]] && echo "${spec%@*}" || echo "$spec"
}

# The gate NAMED_ONLY and CMS_PLUS share. Every lockfile entry that changed must
# be one of the named packages or reachable from one through the lockfile's own
# dependency graph; peers are not edges, so naming cms cannot license a vue move.
# Sets MOVED (one line per changed entry, for the operator and for ship-site.sh).
drift_gate() {
  local out rc
  out=$(node "$CMS_REPO/tools/fleet/check-lockfile-drift.mjs" \
          "$S/$SITE-lock-before.json" package-lock.json "$@" 2>&1 >"$S/$SITE-moved.txt")
  rc=$?
  if [[ $rc != 0 ]]; then
    echo "$out" | sed 's/^/  /'
    fail "lockfile drift is not confined to the named packages (see above)"
  fi
  [[ -n "$out" ]] && echo "$out" | sed 's/^/  /'
  MOVED=$(awk 'NR>1{printf ", "}{printf "%s", $0}' "$S/$SITE-moved.txt")
  MOVED_JSON=$(jq -R -s -c 'split("\n") | map(select(length > 0))' "$S/$SITE-moved.txt")
  [[ -n "$MOVED" ]] || MOVED="nothing (already current)"
}

require_target() {
  [[ -n "$CMS_TARGET" ]] || fail "CMS_TARGET is required (the site is on @koehler8/cms $(ver @koehler8/cms)) — which release the fleet moves to is a decision, never a default"
  local cur=$(ver @koehler8/cms)
  [[ "$(printf '%s\n%s\n' "$cur" "$CMS_TARGET" | sort -V | tail -1)" == "$CMS_TARGET" ]] || fail "CMS_TARGET=$CMS_TARGET is BELOW the locked $cur — this driver does not downgrade"
}

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
  require_target
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
  require_target
  cp package-lock.json "$S/$SITE-lock-before.json"
  MODE=deps
  MOVED_JSON='[]'
  NAMES_JSON='[]'

  # REMOVE_PKG — uninstall a package the fleet no longer uses. The cheapest way
  # to clear an advisory is to stop shipping the tree that carries it.
  if [[ -n "${REMOVE_PKG:-}" ]]; then
    MODE=remove
    local removing=(${=REMOVE_PKG})
    NAMES_JSON=$(printf '%s\n' $removing | jq -R . | jq -sc .)
    [[ "$(ver @koehler8/cms)" == "$CMS_TARGET" ]] \
      || fail "REMOVE_PKG: the site is on @koehler8/cms $(ver @koehler8/cms), not $CMS_TARGET — this mode asserts the framework, it never moves it"
    for p in $removing; do
      [[ "$(ver $p)" != "-" ]] || fail "$p is not installed here — nothing to remove"
      if is_registered "$p"; then
        # Uninstalling a REGISTERED extension breaks the build, so the two must
        # happen together. UNREGISTER=1 is the operator saying so; without it
        # this refuses rather than quietly editing a never-touch file.
        [[ -n "${UNREGISTER:-}" ]] || fail "$p is still REGISTERED in vite.config.js — rerun with UNREGISTER=1 to take it out of the extensions array in the same commit"
        cp vite.config.js "$S/$SITE-vite.before"
        # Two perl traps, both of which edit NOTHING while exiting 0:
        #   s{}{} not s///  -- a scoped name contains a slash, and the default
        #     delimiter makes perl read the rest as division.
        #   $ENV{P} not "$p" -- '@koehler8' is an ARRAY interpolation in perl and
        #     it interpolates even inside \Q...\E, quietly leaving '/cms-ext-crypto'.
        # So: single-quoted program (the shell touches nothing), name via the
        # environment, \x27 for the quote character.
        local strip='s{\x27\Q$ENV{P}\E\x27,\s*}{}g; s{,\s*\x27\Q$ENV{P}\E\x27}{}g'
        P="$p" perl -i -pe "$strip" vite.config.js || fail "perl failed editing vite.config.js"
        is_registered "$p" && fail "could not unregister $p from vite.config.js — edit it by hand"
        # exactly one line changed...
        local vlines=$(diff "$S/$SITE-vite.before" vite.config.js | grep -c '^[<>]')
        [[ "$vlines" == 2 ]] || fail "unregistering $p changed $vlines diff lines in vite.config.js, expected one line replaced"
        # ...and ignoring whitespace the new file is the old one with exactly that
        # entry gone. Computed with a literal replacement rather than a zsh glob:
        # the glob form silently matched nothing and compared a string to itself.
        local nb=$(tr -d '[:space:]' < "$S/$SITE-vite.before")
        local na=$(tr -d '[:space:]' < vite.config.js)
        local expect=$(printf '%s' "$nb" | P="$p" perl -pe "$strip")
        [[ "$na" == "$expect" && "$na" != "$nb" ]] \
          || fail "unregistering $p changed more than that one array entry in vite.config.js"
        UNREGISTERED=1
        echo "  unregistered $p from vite.config.js (one line, that entry only)"
      fi
    done
    npm uninstall $removing --no-audit --no-fund >/dev/null 2>&1 || fail "npm uninstall $REMOVE_PKG failed"
    for p in $removing; do
      [[ "$(ver $p)" == "-" ]] || fail "$p is STILL in the lockfile after uninstall"
      [[ "$(jq -r --arg n "$p" '.dependencies[$n] // .devDependencies[$n] // "-"' package.json)" == "-" ]] || fail "$p is still declared in package.json"
    done
    local flags=()
    for n in $removing; do flags+=(--removal-of "$n"); done
    local nb=$(jq '.packages|length' "$S/$SITE-lock-before.json")
    drift_gate $flags
    local na=$(jq '.packages|length' package-lock.json)
    # 250+ removals is not a useful commit body; summarise by scope instead
    local tops=$(comm -23 \
      <(jq -r '.packages|keys[]|select(test("^node_modules/(@[^/]+/)?[^/]+$"))' "$S/$SITE-lock-before.json" | sed 's#^node_modules/##' | sort) \
      <(jq -r '.packages|keys[]|select(test("^node_modules/(@[^/]+/)?[^/]+$"))' package-lock.json | sed 's#^node_modules/##' | sort))
    # ${(@f)...} splits on NEWLINES only -- an unquoted $(...) splits on spaces
    # and turns each "@solana/* (39)" into two lines
    local scopes=("${(@f)$(echo "$tops" | grep '^@' | cut -d/ -f1 | sort | uniq -c | sort -rn | awk '{printf "%s/* (%s)\n", $2, $1}')}")
    local plain=$(echo "$tops" | grep -v '^@' | wc -l | tr -d ' ')
    MOVED_JSON=$(printf '%s\n' "uninstalled ${(j:, :)removing}" \
      "lockfile $nb -> $na entries; $(echo "$tops" | grep -c .) top-level packages gone" \
      "${scopes[@]}" "$plain unscoped packages" \
      | grep -v '^$' | jq -R . | jq -sc .)
    MOVED="uninstalled ${(j:, :)removing}; lockfile $nb -> $na entries"
    echo "  bump[remove]: $MOVED"
    return 0
  fi

  # NAMED_ONLY — move transitive packages by name and nothing else. The
  # framework is ASSERTED here, never installed: this mode exists for a
  # lockfile-only advisory clear (ethers 6.16.0 pins ws 8.17.1 exactly; 6.17.0
  # pins 8.21.0), and a cms bump riding along would make the commit a lie.
  if [[ -n "${NAMED_ONLY:-}" ]]; then
    MODE=named
    local named=(${=NAMED_ONLY})
    NAMES_JSON=$(printf '%s\n' $named | jq -R . | jq -sc .)
    [[ "$(ver @koehler8/cms)" == "$CMS_TARGET" ]] \
      || fail "NAMED_ONLY: the site is on @koehler8/cms $(ver @koehler8/cms), not $CMS_TARGET — this mode asserts the framework, it never moves it"
    npm update $named --no-audit --no-fund >/dev/null 2>&1 || fail "npm update $NAMED_ONLY failed"
    git diff --quiet -- package.json || fail "NAMED_ONLY changed package.json — these are transitive packages, nothing declared should move"
    # Everything the operator did not name stays frozen — including the wallet
    # libraries that sit directly above the named packages. @reown/appkit
    # depends on viem; viem does not depend on @reown/appkit, so the drift gate
    # would already refuse it, and this says so by name.
    for p in $FROZEN; do
      [[ " $NAMED_ONLY " == *" $p "* ]] && continue
      local a=$(ver $p "$S/$SITE-lock-before.json") b=$(ver $p)
      [[ "$a" == "$b" ]] || fail "$p moved $a -> $b (must not move — it is not one of: $NAMED_ONLY)"
    done
    local flags=()
    for n in $named; do flags+=(--allow "$n"); done
    drift_gate $flags
    echo "  bump[named-only]: $MOVED"
    echo "    now: $(for n in $named; do printf '%s %s  ' $n $(ver $n); done)"
    return 0
  fi

  # cms, and any CMS_PLUS spec that carries a version, go in ONE install so npm
  # resolves their peers against each other rather than in two steps.
  local install=() plusNames=()
  [[ "$(ver @koehler8/cms)" != "$CMS_TARGET" ]] && install+=("@koehler8/cms@$CMS_TARGET")
  if [[ -n "${CMS_PLUS:-}" ]]; then
    MODE=plus
    for spec in ${=CMS_PLUS}; do
      local name=$(spec_name "$spec")
      plusNames+=("$name")
      [[ "$spec" != "$name" ]] && install+=("$spec")
    done
    NAMES_JSON=$(printf '%s\n' $plusNames | jq -R . | jq -sc .)
  fi
  if (( ${#install} > 0 )); then
    npm install $install --no-audit --no-fund >/dev/null 2>&1 || fail "npm install $install failed"
  fi
  # CMS_ONLY=1 — a framework-release pass. Nothing but cms may move, and that is
  # ENFORCED, not hoped for: a patch release of anything else landing mid-pass
  # must not ride along on a commit that says "cms 1.3.0 -> 1.3.1". Valid only
  # when the release left cms's own dependencies / peerDependencies alone (check
  # `git diff vA vB -- package.json` in this repo first); then a site's lockfile
  # changes in exactly two entries — the root (its declared range) and cms.
  if [[ -n "${CMS_ONLY:-}" ]]; then
    MODE=cms
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
    MOVED_JSON=$(jq -nc --arg m "$MOVED" '[$m]')
    return 0
  fi
  # CMS_PLUS — the framework release that brings a bundled runtime dependency
  # with it. Still enforced, just with the right invariant: cms, the names the
  # operator listed, and whatever THOSE depend on. pinia must stay a single
  # instance (cms hands one pinia to every extension), and the peers that force
  # this track's release order are checked rather than assumed.
  if [[ -n "${CMS_PLUS:-}" ]]; then
    assert_toolchain
    [[ "$(ver @koehler8/cms)" == "$CMS_TARGET" ]] || fail "@koehler8/cms is $(ver @koehler8/cms), expected $CMS_TARGET"
    for spec in ${=CMS_PLUS}; do
      local name=$(spec_name "$spec")
      [[ "$spec" == "$name" ]] && continue
      [[ "$(ver $name)" == "${spec##*@}" ]] || fail "$name is $(ver $name), expected exactly ${spec##*@}"
    done
    local flags=(--allow @koehler8/cms)
    for n in $plusNames; do flags+=(--allow "$n"); done
    flags+=(--single pinia --peer vue-router:pinia --peer @koehler8/cms-ext-crypto:pinia)
    drift_gate $flags
    echo "  bump[cms+]: $MOVED"
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
  # plain comparison, not a ${array:#pattern} match -- the clever form silently
  # failed to match a string it should have, and cost a whole gated run
  local allowed=("" "package-lock.json package.json " "package-lock.json ")
  [[ "${UNREGISTERED:-0}" == 1 ]] && allowed+=("package-lock.json package.json vite.config.js ")
  local okfiles=0 a=
  for a in "${allowed[@]}"; do [[ "$changed" == "$a" ]] && okfiles=1; done
  (( okfiles )) || fail "unexpected files changed: [$changed]"
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
  # A dependency change must leave every page identical -- EXCEPT when the whole
  # point is that a page changes (unregistering an extension takes its component
  # out of the header). Then the operator must say in words what should change;
  # the diff is PRINTED for review and the reason is recorded, never silently
  # waved through. An empty EXPECT_PAGE_DIFF is not accepted.
  if node "$CMS_REPO/scripts/diff-ssg-dist.mjs" "$S/$SITE-dist-before" "$S/$SITE-dist-after" > "$S/$SITE-diff.log" 2>&1; then
    PAGES_DIFFER=0
  elif [[ -n "${EXPECT_PAGE_DIFF:-}" ]]; then
    PAGES_DIFFER=1
    echo "  after: pages DIFFER, as expected — \"$EXPECT_PAGE_DIFF\""
    echo "  ----- diff-ssg-dist (read this; it is not a gate in this mode) -----"
    sed 's/^/    /' "$S/$SITE-diff.log" | head -40
    echo "  ----- full log: $S/$SITE-diff.log -----"
  else
    head -24 "$S/$SITE-diff.log"; fail "diff-ssg-dist found differences (full log: $S/$SITE-diff.log)"
  fi
  thin() { (cd "$1" && find . -name '*.html' -size -4k | sort); }
  diff <(thin "$S/$SITE-dist-before") <(thin "$S/$SITE-dist-after") >/dev/null || fail "the set of near-empty pages changed"
  # vite.config.js is never-touch EXCEPT for the unregister the removal needed,
  # which was asserted line-by-line at the point it was made
  if [[ "${UNREGISTERED:-0}" == 1 ]]; then
    [[ -z "$(git status --short -- amplify.yml)" ]] || fail "a never-touch file changed"
  else
    [[ -z "$(git status --short -- vite.config.js amplify.yml)" ]] || fail "a never-touch file changed"
  fi
  local checks=0
  for c in builder/checks/*.check.mjs(N); do
    node "$c" >/dev/null 2>&1 || { node "$c" | grep -i fail | head -5; fail "acceptance check $c is red"; }
    checks=$((checks+1))
  done
  for sc in builder/scanners/token-surface.mjs(N) builder/scanners/canon-tripwires.mjs(N); do
    [[ "$(node "$sc" 2>/dev/null | tr -d ' \n')" == "[]" ]] || fail "scanner $sc reports findings"
  done
  [[ "${PAGES_DIFFER:-0}" == 0 ]] || echo "  after: $ha pages, differences reviewed above"
  local theme=$(grep -o 'theme fingerprint: [0-9]*' "$S/$SITE-diff.log" | grep -o '[0-9]*$')
  local rss_before=$(grep "maximum resident set size" "$S/$SITE-build-before.log" | awk '{printf "%.0f", $1/1048576}')
  local verdict="$ha pages identical"; [[ "${PAGES_DIFFER:-0}" == 0 ]] || verdict="$ha pages, diff reviewed"
  echo "  after: $verdict, theme unchanged ($theme declarations), checks green=$checks, peakRSS ${rss_before}->${RSS_MB}MB"
  jq -nc --arg site "$SITE" --arg cms "$(ver @koehler8/cms)" --arg vite "$(ver vite)" --arg vue "$(ver vue)" \
     --argjson pages "$ha" --argjson theme "${theme:-0}" --argjson rss "${RSS_MB:-0}" --argjson checks "$checks" \
     --argjson audit "${AUDIT:-\"UNKNOWN\"}" --arg at "$(date -u +%FT%TZ)" \
     --arg mode "${MODE:-deps}" --argjson moved "${MOVED_JSON:-[]}" --argjson names "${NAMES_JSON:-[]}" \
     --argjson pagesDiffer "${PAGES_DIFFER:-0}" --arg pageDiffReason "${EXPECT_PAGE_DIFF:-}" \
     '{site:$site,result:"READY",mode:$mode,names:$names,moved:$moved,pagesDiffer:($pagesDiffer==1),pageDiffReason:$pageDiffReason,cms:$cms,vite:$vite,vue:$vue,pages:$pages,theme:$theme,peakRssMb:$rss,checks:$checks,audit:$audit,at:$at}' >> "$LEDGER"
}

phase_restore() {
  git checkout HEAD -- package.json package-lock.json vite.config.js 2>/dev/null
  echo "  restored package.json + package-lock.json + vite.config.js to HEAD (node_modules is ahead; the next npm ci resyncs it)"
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
