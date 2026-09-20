#!/bin/zsh
# bump-product.sh — take ONE non-site product repo through the Track 1 in-range
# dependency refresh, gated. Sibling of cms/tools/fleet/bump-site.sh, but for
# repos that HAVE a test suite and DON'T have an SSG dist to diff.
#
#   bump-product.sh <repo-dir-name> [all|pre|baseline|bump|gates|rehearse|verify|restore]
#
# It never commits and never pushes. It exits non-zero at the first failed gate,
# and in `all` mode a failure after the bump restores package.json and
# package-lock.json so the repo is left exactly as it was found.
#
# Why this exists (Track 1 plan, ~/.claude/plans/track-1-products-in-range-refresh.md):
# these five repos release to production on merge or on one command, and three of
# them front mainnet programs. The judgement that matters is the lockfile diff —
# so the driver's real output is the full list of entries whose version changed,
# printed for a human to read, plus a hard assertion that nothing on the HELD
# list moved.
#
# Environment (per repo — the operator sets these, the driver never guesses):
#   BUMP_NAMES   space-separated explicit package names for `npm update`.
#                EMPTY = no-op proof run (bump phase asserts nothing changed).
#   WEB_BUILD    command that builds the web workspace (empty = no web package)
#   ALLOW_DIRTY  space-separated paths permitted to be dirty before AND after
#                (engine-mintmill's SST-generated sst-env.d.ts)
#   IGNORE_PRS   space-separated PR numbers already inspected and judged benign
#   FREEZE_PREFIXES  package-name prefixes that may NOT move, e.g. "@solana/
#                "@metaplex-foundation/umi". Anything named in BUMP_NAMES is
#                exempt. Use this instead of extending HELD for a whole family.
#   PRODUCT_SCRATCH  where logs/ledger go (default: $TMPDIR/fleet-bump-product)
#
# NEVER: bare `npm update`, `npm audit fix`, `rm package-lock.json`, npm 11.

set -u
REPO="${1:?usage: bump-product.sh <repo-dir-name> [phase]}"
PHASE="${2:-all}"
HERE="${0:A:h}"
ROOT="${PRODUCT_ROOT:-/Users/chris/builder}"
S="${PRODUCT_SCRATCH:-${TMPDIR:-/tmp}/fleet-bump-product}"
LEDGER="$S/ledger.jsonl"
mkdir -p "$S"
cd "$ROOT/$REPO" || { echo "no such repo: $ROOT/$REPO"; exit 2; }

# ⛔ HELD — the plan's list. A version change in any of these is a hard stop,
# whether we asked for it or npm decided it. `@solana/web3.js` is the headline:
# in-range at 1.99.0 and offered in all three engines, but it drags
# @solana/codecs-numbers ^2 -> ^5 under three mainnet engines. It gets decided
# once, with crypto/, not as a drive-by.
HELD=(@solana/web3.js @solana/codecs-core @solana/codecs-numbers @solana/codecs-strings
      @solana/codecs-data-structures @solana/codecs @noble/curves @noble/hashes
      @metaplex-foundation/umi @metaplex-foundation/umi-bundle-defaults
      @metaplex-foundation/umi-uploader-irys @metaplex-foundation/umi-web3js-adapters
      @metaplex-foundation/mpl-core @metaplex-foundation/mpl-core-candy-machine
      @coral-xyz/anchor @meteora-ag/dlmm @meteora-ag/cp-amm-sdk @sqds/multisig
      sst vite vitest typescript vue-router pinia vue-tsc @vitejs/plugin-vue)

source ~/.nvm/nvm.sh >/dev/null 2>&1
nvm use >/dev/null 2>&1

fail() { echo "GATE FAILED [$REPO/$CURRENT]: $*"; exit 1; }
# Every resolved copy of a package, hoisted or nested, as one sorted string.
# "1.98.4" = one copy; "1.98.4+2.0.0" = two (the engines run web3.js v1 and v2
# side by side on purpose); "-" = not installed here.
ver()  { jq -r --arg k "$1" '[.packages | to_entries[] | select(.key | endswith("node_modules/"+$k)) | .value.version] | unique | sort | join("+") | if . == "" then "-" else . end' "${2:-package-lock.json}"; }

assert_toolchain() {
  local n=$(node -v) m=$(npm -v)
  [[ "$n" == "v20.19.0" && "$m" == 10.8.* ]] || fail "node $n / npm $m — need v20.19.0 / 10.8.x (run nvm use)"
}

# Dirty-tree check that tolerates exactly the paths the operator named.
dirty_files() {
  git status --short | awk '{print $NF}' | while read -r f; do
    local ok=0
    for a in ${=ALLOW_DIRTY:-}; do [[ "$f" == "$a" ]] && ok=1; done
    (( ok )) || echo "$f"
  done
}

# Sum the per-workspace test summaries. TWO runners are in play across these
# repos and a parser for one reads ZERO on the other — which looks like a green
# baseline instead of an unparsed one:
#   vitest (buildmill, entourage):  "Test Files  3 passed" / "Tests  57 passed"
#   node --test via tsx (engines):  TAP "# tests 57" / "# pass 57" / "# fail 0"
# Several workspaces each print their own block, so every line must be summed.
count_tests() { # $1 = log file -> "units/tests/failed"
  local vf=$(grep -Eo 'Test Files +[0-9]+ passed' "$1" | grep -Eo '[0-9]+' | awk '{s+=$1} END{print s+0}')
  local vt=$(grep -Eo '^ *Tests +[0-9]+ passed' "$1" | grep -Eo '[0-9]+' | awk '{s+=$1} END{print s+0}')
  local vx=$(grep -Eo '^ *(Tests|Test Files) +[0-9]+ failed' "$1" | grep -Eo '[0-9]+' | awk '{s+=$1} END{print s+0}')
  local nf=$(grep -cE '^# tests [0-9]+' "$1")
  local nt=$(grep -Eo '^# tests [0-9]+' "$1" | grep -Eo '[0-9]+' | awk '{s+=$1} END{print s+0}')
  local nx=$(grep -Eo '^# fail [0-9]+' "$1" | grep -Eo '[0-9]+' | awk '{s+=$1} END{print s+0}')
  echo "$((vf+nf))/$((vt+nt))/$((vx+nx))"
}

# Run the repo's OWN builder/verify.json commands, verbatim and in order.
run_verify() { # $1 = label
  local log="$S/$REPO-verify-$1.log"
  : > "$log"
  local n=$(jq '.commands | length' builder/verify.json)
  local i=0
  while (( i < n )); do
    local cmd=$(jq -r ".commands[$i]" builder/verify.json)
    echo "### $cmd" >> "$log"
    eval "$cmd" >> "$log" 2>&1 || { echo "--- tail of $log:"; tail -25 "$log"; fail "verify command failed ($1): $cmd"; }
    i=$((i+1))
  done
  # The plan adds typecheck and the web build where verify.json omits them.
  if ! jq -e '.commands[] | select(test("typecheck"))' builder/verify.json >/dev/null 2>&1; then
    if jq -e '.scripts.typecheck' package.json >/dev/null 2>&1; then
      echo "### npm run typecheck (added by the plan)" >> "$log"
      npm run typecheck >> "$log" 2>&1 || { tail -25 "$log"; fail "typecheck failed ($1)"; }
    fi
  fi
  if [[ -n "${WEB_BUILD:-}" ]]; then
    echo "### $WEB_BUILD" >> "$log"
    eval "$WEB_BUILD" >> "$log" 2>&1 || { tail -25 "$log"; fail "web build failed ($1)"; }
  fi
  COUNTS=$(count_tests "$log")
  echo "  $1: tests files/tests/failed = $COUNTS  (log: $log)"
}

phase_pre() {
  assert_toolchain
  git pull --ff-only >/dev/null 2>&1 || fail "git pull --ff-only failed"
  local dirty=$(dirty_files)
  [[ -z "$dirty" ]] || { echo "$dirty"; fail "working tree has unexpected changes"; }
  # An open PR means someone else may be about to change this repo. A PR the
  # operator has already inspected and judged benign is excused BY NUMBER
  # (IGNORE_PRS="33") — and even then never if it touches package.json or the
  # lockfile, because that is the only thing this bump can collide with.
  # NB: bind .number/.headRefName BEFORE the `$ig | contains(...)` pipe — inside
  # that pipe `.` is the string $ig, not the PR.
  local prs=$(gh pr list --repo "koehler8/$REPO" --state open --json number,headRefName,files 2>/dev/null \
    | jq -r --arg ig " ${IGNORE_PRS:-} " '
        .[] | (.number|tostring) as $n | .headRefName as $head
            | ([.files[].path] | any(. == "package.json" or . == "package-lock.json")) as $dep
            | select((($ig | contains(" " + $n + " ")) and ($dep | not)) | not)
            | "#\($n) \($head) touchesDeps=\($dep)"' | tr '\n' '; ')
  [[ -z "$prs" ]] || fail "open PR(s) needing a decision: $prs"
  echo "  pre: clean, in sync with origin ($(git rev-parse --short HEAD)), node $(node -v)/npm $(npm -v), no blocking PRs"
}

phase_baseline() {
  assert_toolchain
  cp package-lock.json "$S/$REPO-lock-before.json"
  run_verify before
  BASE_COUNTS="$COUNTS"
  echo "$COUNTS" > "$S/$REPO-counts-before.txt"
  AUDIT_BEFORE=$(audit_now); echo "  baseline audit: $AUDIT_BEFORE"
  echo "$AUDIT_BEFORE" > "$S/$REPO-audit-before.txt"
  [[ "${COUNTS##*/}" == 0 ]] || fail "baseline is RED (${COUNTS##*/} failing) — that is a finding for Chris, not something to bump over"
  # A parser that does not recognise the runner reports 0/0/0, which is
  # indistinguishable from a green run. Refuse it: no tests counted means the
  # baseline was never established.
  [[ "$(echo $COUNTS | cut -d/ -f2)" -gt 0 ]] || fail "counted ZERO tests — the suite did not run, or its output format is unrecognised. A 0/0/0 baseline is not a baseline."
  # npm ls --all as a BASELINE, not an absolute. engine-numuse is already
  # invalid at HEAD (@tensor-foundation/marketplace nests @solana-program/system
  # peer-wanting @solana/web3.js@2.0.0-rc.4 against the 2.0.0 installed), so an
  # absolute gate would block a bump over a condition the bump did not cause.
  npm ls --all >/dev/null 2>&1 && LS_BASE=clean || LS_BASE=$(npm ls --all 2>&1 | grep -cE '^npm error invalid|^npm error missing')
  echo "$LS_BASE" > "$S/$REPO-lsbase.txt"
  echo "  baseline: npm ls --all = $LS_BASE"
}

# No result is UNKNOWN, never zero — npm's advisory endpoint does go down.
audit_now() {
  local a=$(npm audit --json 2>/dev/null | jq -c '.metadata.vulnerabilities | {critical,high,moderate,low}' 2>/dev/null)
  [[ -n "$a" && "$a" != "null" ]] && echo "$a" || echo '"UNKNOWN"'
}

phase_bump() {
  assert_toolchain
  [[ -f "$S/$REPO-lock-before.json" ]] || cp package-lock.json "$S/$REPO-lock-before.json"
  if [[ -z "${BUMP_NAMES:-}" ]]; then
    echo "  bump: NO-OP RUN (BUMP_NAMES empty) — nothing requested"
  else
    # --workspaces --include-workspace-root is NOT decoration. From the root
    # alone, npm update silently skipped 8 of 9 in-range AWS clients plus
    # mpl-toolbox and @types/aws-lambda in engine-numuse — exit code 0, nothing
    # moved. Only packages/* declare them, so the root-only update never saw them.
    npm update ${=BUMP_NAMES} --workspaces --include-workspace-root --no-audit --no-fund >/dev/null 2>&1 || fail "npm update failed"
    local moved=0
    for p in ${=BUMP_NAMES}; do
      local a=$(ver $p "$S/$REPO-lock-before.json") b=$(ver $p)
      [[ "$a" != "$b" ]] && moved=$((moved+1))
    done
    # THE assertion, not just a count: believe the registry, not the exit code.
    # Anything we explicitly asked for that npm still reports as in-range-behind
    # did not move, and a partial bump must never read as a finished one.
    local want=$(printf '%s\n' ${=BUMP_NAMES} | jq -R . | jq -sc .)
    local stale=$(npm outdated --json --workspaces --include-workspace-root 2>/dev/null \
      | jq -r --argjson want "$want" '
          to_entries[] | .key as $k | select($want | index($k))
          | (.value | if type=="array" then .[] else . end)
          | select(.current != .wanted) | "\($k) \(.current)->\(.wanted)"' | sort -u | tr '\n' ' ')
    [[ -z "$stale" ]] || fail "requested but STILL outdated after npm update: $stale"
    echo "  bump: $moved of $(echo ${=BUMP_NAMES} | wc -w | tr -d ' ') requested packages moved; none left outdated"
  fi
  # HELD assertion runs on EVERY bump phase, no-op included.
  for p in $HELD; do
    local a=$(ver $p "$S/$REPO-lock-before.json") b=$(ver $p)
    [[ "$a" == "$b" ]] || fail "HELD package $p moved $a -> $b"
  done
  echo "  bump: HELD list asserted — all ${#HELD} unchanged (@solana/web3.js $(ver @solana/web3.js))"
  # FREEZE_PREFIXES — the generalisation the engines forced. A named HELD list
  # cannot cover a family: engine-numuse locks EIGHTEEN @metaplex-foundation/umi*
  # packages at 1.5.1 while `overrides` names only four, and @solana/* has
  # several versions coexisting on purpose (the w3v2 alias). So freeze by
  # PREFIX and let only explicitly-requested names through.
  for pref in ${=FREEZE_PREFIXES:-}; do
    local drift=$(jq -rn --slurpfile a "$S/$REPO-lock-before.json" --slurpfile b package-lock.json \
      --arg p "$pref" --arg allow " ${BUMP_NAMES:-} " '
      ($a[0].packages) as $x | ($b[0].packages) as $y
      | [ (($x|keys)+($y|keys)|unique)[] | select(. != "") | . as $k
          | ($k | sub("^.*node_modules/";"")) as $n
          | select($n | startswith($p))
          | select(($allow | contains(" " + $n + " ")) | not)
          | select(($x[$k].version // "-") != ($y[$k].version // "-"))
          | "\($k) \($x[$k].version // "-")->\($y[$k].version // "-")" ]
      | unique | join("; ")')
    [[ -z "$drift" ]] || fail "frozen prefix '$pref' moved: ${drift:0:400}"
  done
  [[ -z "${FREEZE_PREFIXES:-}" ]] || echo "  bump: frozen prefixes clean [${FREEZE_PREFIXES}]"
}

phase_gates() {
  assert_toolchain
  local changed=$(git status --short | awk '{print $NF}' | sort | tr '\n' ' ')
  for a in ${=ALLOW_DIRTY:-}; do changed="${changed//$a /}"; done
  [[ -z "$changed" || "$changed" == "package-lock.json " ]] || fail "unexpected files changed: $changed"
  [[ "$(jq .lockfileVersion package-lock.json)" == 3 ]] || fail "lockfileVersion is not 3"
  [[ "$(git show HEAD:package.json | jq -cS '.overrides // {}')" == "$(jq -cS '.overrides // {}' package.json)" ]] || fail "package.json overrides changed"
  [[ "$(git show HEAD:package-lock.json | jq -cS '.packages[""].overrides // {}')" == "$(jq -cS '.packages[""].overrides // {}' package-lock.json)" ]] || fail "lockfile root overrides changed"
  # Compare against the baseline reading, never against "clean".
  local lsbase=$(cat "$S/$REPO-lsbase.txt" 2>/dev/null || echo clean)
  local lsnow; npm ls --all >/dev/null 2>&1 && lsnow=clean || lsnow=$(npm ls --all 2>&1 | grep -cE '^npm error invalid|^npm error missing')
  if [[ "$lsbase" == clean ]]; then
    [[ "$lsnow" == clean ]] || { npm ls --all 2>&1 | grep -E '^npm error' | head -8; fail "npm ls --all was clean at baseline and is now $lsnow"; }
  else
    if [[ "$lsnow" == clean ]]; then
      echo "  gates: npm ls --all went $lsbase problem(s) -> CLEAN (the bump fixed a pre-existing tree problem)"
    else
      [[ "$lsnow" -le "$lsbase" ]] || { npm ls --all 2>&1 | grep -E '^npm error' | head -8; fail "npm ls --all problems went $lsbase -> $lsnow"; }
      echo "  gates: npm ls --all $lsnow problem(s) — no worse than the PRE-EXISTING baseline of $lsbase, not caused here"
    fi
  fi
  # EBADENGINE is reported, never hidden and never a gate by itself: the
  # ecosystem is already leaving Node 20, so a pre-existing floor (buildmill's
  # @aws/durable-execution-sdk-js wants >=22) is expected. What matters is
  # whether the bump ADDED one — compare against the baseline count.
  local ebnames=$(npm install --dry-run --no-audit --no-fund 2>&1 | grep -A1 'EBADENGINE Unsupported' | grep 'package:' | sed "s/.*package: '//;s/'.*//" | sort -u | tr '\n' ' ')
  local eb=$(echo $ebnames | wc -w | tr -d ' ')
  echo "  gates: lockfileVersion 3, overrides byte-identical, EBADENGINE=$eb [${ebnames:-none}]"
  # Optional native bindings completeness — the npm-11 strip invariant, generic.
  node "$ROOT/cms/scripts/check-site-lockfile.mjs" . >/dev/null 2>&1 \
    && echo "  gates: check-site-lockfile PASS" \
    || echo "  gates: check-site-lockfile not applicable here (site-shaped assertions) — see the per-entry diff below"
  AUDIT_AFTER=$(audit_now)
  echo "  gates: audit before=$(cat $S/$REPO-audit-before.txt 2>/dev/null) after=$AUDIT_AFTER"
  echo "$AUDIT_AFTER" > "$S/$REPO-audit-after.txt"
  # THE output that matters: every lockfile entry whose version changed.
  jq -rn --slurpfile a "$S/$REPO-lock-before.json" --slurpfile b package-lock.json '
    ($a[0].packages) as $x | ($b[0].packages) as $y
    | [ (($x|keys)+($y|keys)|unique)[] | select(. != "")
        | . as $k | {k:$k, from:($x[$k].version // "-"), to:($y[$k].version // "-")}
        | select(.from != .to) ]
    | sort_by(.k)[] | "    \(.k)  \(.from) -> \(.to)"' > "$S/$REPO-lockdiff.txt"
  # A workspace link entry ("resolved": "packages/core", "link": true) carries no
  # .version at all, so both sides default to "-" and it never shows up above —
  # correct, but it means the diff is a VERSION diff. Entries appearing or
  # disappearing wholesale are caught separately:
  jq -rn --slurpfile a "$S/$REPO-lock-before.json" --slurpfile b package-lock.json '
    (($b[0].packages|keys) - ($a[0].packages|keys) | map("+ "+.))
    + (($a[0].packages|keys) - ($b[0].packages|keys) | map("- "+.))
    | .[] | "    \(.)"' >> "$S/$REPO-lockdiff.txt"
  local n=$(wc -l < "$S/$REPO-lockdiff.txt" | tr -d ' ')
  echo "  gates: $n lockfile entries changed (full list: $S/$REPO-lockdiff.txt)"
  [[ "$n" == 0 ]] || { echo "  ---- read this entry by entry; anything unexplained is a STOP ----"; cat "$S/$REPO-lockdiff.txt"; }
}

phase_rehearse() {
  assert_toolchain
  local R="$S/$REPO-rehearsal"
  rm -rf "$R" && mkdir -p "$R" && git ls-files | cpio -pdm "$R" 2>/dev/null
  cp package.json package-lock.json "$R"/
  ( cd "$R"
    npm ci --no-audit --no-fund >/dev/null 2>&1 || exit 11
    cmp -s package-lock.json "$ROOT/$REPO/package-lock.json" || exit 12
    rm -rf node_modules packages/*/node_modules(N)
    npm ci --os=linux --cpu=x64 --no-audit --no-fund >/dev/null 2>&1 || exit 13
  )
  local rc=$?
  case $rc in
    0) echo "  rehearse: clean-copy npm ci passes, lockfile byte-identical, linux-x64 install materialises" ;;
    11) fail "npm ci failed in a clean copy" ;;
    12) fail "npm ci REWRITES the lockfile" ;;
    13) fail "linux-x64 npm ci failed (SST bundles Lambdas for Linux; Amplify builds the console there)" ;;
    *) fail "rehearsal failed ($rc)" ;;
  esac
  rm -rf "$R"
}

phase_verify() {
  assert_toolchain
  run_verify after
  local before=$(cat "$S/$REPO-counts-before.txt")
  [[ "$COUNTS" == "$before" ]] || fail "test counts moved $before -> $COUNTS (files/tests/failed) — same numbers or it is not the same suite"
  echo "  verify: identical suite green ($COUNTS)"
  jq -nc --arg repo "$REPO" --arg counts "$COUNTS" --arg head "$(git rev-parse --short HEAD)" \
     --argjson before "$(cat $S/$REPO-audit-before.txt)" --argjson after "$(cat $S/$REPO-audit-after.txt)" \
     --arg w3 "$(ver @solana/web3.js)" --arg at "$(date -u +%FT%TZ)" \
     '{repo:$repo,result:"READY",head:$head,tests:$counts,auditBefore:$before,auditAfter:$after,web3js:$w3,at:$at}' >> "$LEDGER"
}

phase_restore() {
  git checkout HEAD -- package.json package-lock.json 2>/dev/null
  echo "  restored package.json + package-lock.json to HEAD"
}

run() { CURRENT="$1"; "phase_$1"; }

if [[ "$PHASE" == all ]]; then
  echo "== $REPO"
  BUMPED=0
  trap '[[ $? -ne 0 && $BUMPED == 1 ]] && { echo "  -> leaving the repo untouched"; phase_restore; jq -nc --arg repo "$REPO" --arg at "$(date -u +%FT%TZ)" "{repo:\$repo,result:\"FAILED\",at:\$at}" >> "$LEDGER"; }' EXIT
  run pre; run baseline; BUMPED=1; run bump; run gates; run rehearse; run verify
  BUMPED=0
  echo "  READY — all gates green; review the lockfile diff, then commit and push by hand"
else
  run "$PHASE"
fi
