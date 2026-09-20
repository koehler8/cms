/**
 * check-lockfile-drift — classify every package-lock.json entry that changed
 * between two lockfiles as EXPECTED or UNEXPECTED, given the packages the
 * operator explicitly named.
 *
 * Why this exists. bump-site.sh's CMS_ONLY gate proved its worth during the
 * 1.3.1 pass: it asserts that a framework-release commit moved *exactly* the
 * framework, so a patch release of something else landing that morning cannot
 * ride along on a commit whose message says otherwise. The same discipline is
 * needed for two passes CMS_ONLY cannot express:
 *
 *   - NAMED_ONLY — move a transitive package by name (`ethers viem ws`) and
 *     nothing else. The root package.json does not change at all.
 *   - CMS_PLUS   — a framework release that legitimately drags a bundled
 *     runtime dependency with it (cms 1.4.0 carries pinia 4), where "exactly
 *     two entries moved" is the wrong invariant but "only cms, the names I
 *     listed, and what THEY depend on" is the right one.
 *
 * The rule both need is the same: a changed entry is expected if it is one of
 * the named packages, or is reachable from one of them through the lockfile's
 * own dependency graph. Everything else is drift and fails the gate.
 *
 * Deliberate choices, each one a place where a looser rule would let something
 * through:
 *   - peerDependencies are NOT edges. A package does not install its peers;
 *     npm satisfies them from elsewhere in the tree. Following peer edges from
 *     `ethers` would reach half the site. A peer that moved is exactly the kind
 *     of thing a human should look at.
 *   - "changed" means the whole entry differs, not just `.version`. A re-resolved
 *     integrity or a rewritten dependency map is a change worth seeing.
 *   - The root entry ("") is reported separately, by declared-range, because its
 *     diff is the package.json edit rather than an installed package.
 *   - satisfies() REFUSES range syntax it does not fully implement rather than
 *     guessing. An unreadable range fails the gate and a human looks at it.
 *
 * Lives under tools/ — outside package.json `files` — so it never ships to npm.
 *
 * Run:
 *   node tools/fleet/check-lockfile-drift.mjs <before-lock> <after-lock> \
 *        --allow <name> [--allow <name> ...] \
 *        [--single <name> ...] [--peer <dependent>:<peer> ...] [--json]
 *
 * Exits 0 and prints one line per changed entry; exits 1 listing every problem.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PREFIX = 'node_modules/';

/** npm's resolution walk: nearest node_modules first, then each ancestor's. */
export function resolveFrom(packages, parentKey, name) {
  let base = parentKey;
  for (;;) {
    const candidate = base ? `${base}/${PREFIX}${name}` : `${PREFIX}${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf(`/${PREFIX}`);
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

/** 'node_modules/a/node_modules/@scope/b' -> '@scope/b' */
export function entryName(key) {
  const cut = key.lastIndexOf(PREFIX);
  return cut === -1 ? '' : key.slice(cut + PREFIX.length);
}

/** Every key in the tree whose package name is `name` (nested copies included). */
export function copiesOf(lock, name) {
  return Object.keys(lock?.packages ?? {}).filter((key) => entryName(key) === name);
}

/** Key-order-insensitive structural equality — npm is free to reorder fields. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(',')}}`;
}

/**
 * Every entry reachable from the named packages through `dependencies` and
 * `optionalDependencies` — and, with `{ peers: true }`, `peerDependencies` too.
 *
 * Peers are NOT edges by default (see the header): on a bump, following them
 * from `ethers` reaches half the site. On a REMOVAL they are exactly the right
 * edge, because npm 7+ auto-installs peers, so a package that existed only to
 * satisfy a peer of the removed tree is legitimately orphaned by the uninstall.
 * Following them there is safe only because classifyRemoval independently
 * forbids anything being added or any version moving.
 */
export function reachableFrom(packages, names, { peers = false } = {}) {
  const wanted = new Set(names);
  const seen = new Set();
  const queue = [];
  for (const key of Object.keys(packages)) {
    if (key !== '' && wanted.has(entryName(key))) {
      seen.add(key);
      queue.push(key);
    }
  }
  while (queue.length > 0) {
    const key = queue.shift();
    const entry = packages[key] ?? {};
    const deps = [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...(peers ? Object.keys(entry.peerDependencies ?? {}) : []),
    ];
    for (const dep of deps) {
      const target = resolveFrom(packages, key, dep);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

export function classifyDrift(before, after, names) {
  const b = before?.packages ?? {};
  const a = after?.packages ?? {};
  const allowed = new Set(names);
  const reach = new Set([...reachableFrom(b, names), ...reachableFrom(a, names)]);

  const expected = [];
  const unexpected = [];
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (key === '') continue;
    if (canonical(b[key] ?? null) === canonical(a[key] ?? null)) continue;
    const item = {
      key,
      name: entryName(key),
      from: b[key]?.version ?? null,
      to: a[key]?.version ?? null,
    };
    if (allowed.has(item.name) || reach.has(key)) expected.push(item);
    else unexpected.push(item);
  }

  // The root entry mirrors package.json. Its diff is a declared range, not an
  // installed package, so it is judged on its own terms: only a name the
  // operator listed may have had its range edited.
  const rootBefore = b[''] ?? {};
  const rootAfter = a[''] ?? {};
  const rootRanges = [];
  for (const block of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const x = rootBefore[block] ?? {};
    const y = rootAfter[block] ?? {};
    for (const name of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (x[name] !== y[name]) {
        rootRanges.push({ block, name, from: x[name] ?? null, to: y[name] ?? null, allowed: allowed.has(name) });
      }
    }
  }
  const rangeBlocks = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']);
  const rootOther = [...new Set([...Object.keys(rootBefore), ...Object.keys(rootAfter)])]
    .filter((field) => !rangeBlocks.has(field))
    .filter((field) => canonical(rootBefore[field] ?? null) !== canonical(rootAfter[field] ?? null))
    .sort();

  return { expected, unexpected, rootRanges, rootOther };
}

/**
 * The gate for an UNINSTALL. Two clauses, and the second is what makes the
 * first one's peer walk safe:
 *   1. every changed entry is a removal, or a metadata-only change (same
 *      version — npm rewrites dev/peer/optional flags as the tree shrinks).
 *      NOTHING may be added and NO version may move.
 *   2. every removal was reachable from the uninstalled package in the BEFORE
 *      tree, peers included.
 * An uninstall that quietly re-resolves a surviving package is not a removal,
 * and this refuses it.
 */
export function classifyRemoval(before, after, names) {
  const b = before?.packages ?? {};
  const a = after?.packages ?? {};
  const named = new Set(names);
  const reach = reachableFrom(b, names, { peers: true });

  const removed = [];
  const metadata = [];
  const violations = [];
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (key === '') continue;
    if (canonical(b[key] ?? null) === canonical(a[key] ?? null)) continue;
    const item = { key, name: entryName(key), from: b[key]?.version ?? null, to: a[key]?.version ?? null };
    if (!(key in a)) {
      if (reach.has(key) || named.has(item.name)) removed.push(item);
      else violations.push({ ...item, why: 'removed, but nothing in the uninstalled tree reached it' });
    } else if (!(key in b)) {
      violations.push({ ...item, why: 'ADDED by an uninstall' });
    } else if (b[key].version !== a[key].version) {
      violations.push({ ...item, why: 'version MOVED during an uninstall' });
    } else {
      metadata.push(item);
    }
  }

  const rootBefore = b[''] ?? {};
  const rootAfter = a[''] ?? {};
  for (const block of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const x = rootBefore[block] ?? {};
    const y = rootAfter[block] ?? {};
    for (const name of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (x[name] === y[name]) continue;
      if (named.has(name) && y[name] === undefined) continue;
      violations.push({ key: '', name, from: x[name] ?? null, to: y[name] ?? null, why: `package.json ${block} changed and it is not the uninstall` });
    }
  }

  return { removed, metadata, violations };
}

/* ---------------------------------------------------------------- semver -- */

class RangeSyntaxError extends Error {}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match) throw new RangeSyntaxError(`version "${version}" is not a plain x.y.z`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** '3', '3.0' and '3.0.4' -> [3,0,4]-shaped tuple plus how many parts were given. */
function parsePartial(text) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text);
  if (!match) throw new RangeSyntaxError(`"${text}" is not a plain version or partial`);
  const parts = [match[1], match[2], match[3]].filter((part) => part !== undefined).length;
  return { tuple: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], parts };
}

function cmp(x, y) {
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * The upper bound semver gives `^`. Below 1.0.0 the caret tightens by one
 * position for every position the author wrote: ^0.2.3 allows 0.2.x, ^0.0.3
 * allows only 0.0.3, ^0.0 allows 0.0.x and ^0 allows 0.x.
 */
function caretCeiling([major, minor, patch], parts) {
  if (major > 0) return [major + 1, 0, 0];
  if (minor > 0) return [0, minor + 1, 0];
  if (parts === 3) return [0, 0, patch + 1];
  if (parts === 2) return [0, 1, 0];
  return [1, 0, 0];
}

function matchComparator(version, comparator) {
  if (comparator === '*' || comparator === 'x' || comparator === '') return true;
  const operator = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(comparator);
  const [, op = '', rest] = operator;
  if (op === '^') {
    const { tuple, parts } = parsePartial(rest);
    return cmp(version, tuple) >= 0 && cmp(version, caretCeiling(tuple, parts)) < 0;
  }
  if (op === '~') {
    const { tuple, parts } = parsePartial(rest);
    const ceiling = parts >= 2 ? [tuple[0], tuple[1] + 1, 0] : [tuple[0] + 1, 0, 0];
    return cmp(version, tuple) >= 0 && cmp(version, ceiling) < 0;
  }
  const { tuple, parts } = parsePartial(rest);
  if (op === '' || op === '=') {
    if (parts !== 3) throw new RangeSyntaxError(`bare partial "${comparator}" is ambiguous`);
    return cmp(version, tuple) === 0;
  }
  const order = cmp(version, tuple);
  if (op === '>=') return order >= 0;
  if (op === '<=') return order <= 0;
  if (op === '>') return order > 0;
  return order < 0;
}

/**
 * Does `version` satisfy `range`? Supports `*`, exact, `^`, `~`, the four
 * inequality operators, whitespace conjunction and `||` union — and THROWS on
 * anything else (hyphen ranges, `x` wildcards inside a version, prereleases).
 * A gate that cannot read a range must fail, not guess.
 */
export function satisfies(version, range) {
  const parsed = parseVersion(version);
  const text = String(range).trim();
  if (text === '') throw new RangeSyntaxError('empty range');
  if (/[-|]/.test(text.replace(/\|\|/g, ''))) {
    throw new RangeSyntaxError(`range "${range}" uses syntax this matcher does not implement`);
  }
  return text
    .split('||')
    .some((alternative) =>
      alternative
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .every((comparator) => matchComparator(parsed, comparator))
    );
}

/** Is `dependent`'s declared peer on `peer` satisfied by the locked tree? */
export function checkPeer(lock, dependent, peer) {
  const packages = lock?.packages ?? {};
  const key = `${PREFIX}${dependent}`;
  if (!packages[key]) return { status: 'absent', dependent, peer };
  const range = packages[key].peerDependencies?.[peer];
  if (!range) return { status: 'not-a-peer', dependent, peer };
  const resolved = resolveFrom(packages, key, peer);
  const version = resolved ? packages[resolved].version : null;
  if (!version) {
    const optional = packages[key].peerDependenciesMeta?.[peer]?.optional === true;
    return { status: optional ? 'optional-absent' : 'unmet', dependent, peer, range, version: null };
  }
  return { status: satisfies(version, range) ? 'ok' : 'unmet', dependent, peer, range, version };
}

/* ------------------------------------------------------------------- cli -- */

export function parseArgs(argv) {
  const positional = [];
  const options = { allow: [], single: [], peer: [], removalOf: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--allow' || arg === '--single' || arg === '--peer') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)].push(value);
      i += 1;
    } else if (arg === '--removal-of') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--removal-of needs a value');
      options.removalOf.push(value);
      i += 1;
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else positional.push(arg);
  }
  return { positional, options };
}

function describe(item) {
  const label = item.key === `${PREFIX}${item.name}` ? item.name : item.key;
  if (item.from === item.to) return `${label} ${item.to ?? '-'} (metadata)`;
  return `${label} ${item.from ?? 'absent'}->${item.to ?? 'removed'}`;
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [beforePath, afterPath] = positional;
  if (!beforePath || !afterPath || (options.allow.length === 0 && options.removalOf.length === 0)) {
    console.error('usage: check-lockfile-drift.mjs <before-lock> <after-lock> --allow <name> [...]');
    console.error('   or: check-lockfile-drift.mjs <before-lock> <after-lock> --removal-of <name> [...]');
    process.exitCode = 2;
    return;
  }
  const before = JSON.parse(await readFile(beforePath, 'utf-8'));
  const after = JSON.parse(await readFile(afterPath, 'utf-8'));

  if (options.removalOf.length > 0) {
    const { removed, metadata, violations } = classifyRemoval(before, after, options.removalOf);
    if (options.json) {
      console.log(JSON.stringify({ removed, metadata, violations }, null, 2));
    } else {
      for (const item of removed) console.log(`${describe(item)}`);
      console.error(`  ${removed.length} entries removed, ${metadata.length} flag-only, 0 added, 0 versions moved`);
    }
    if (violations.length > 0) {
      console.error(`uninstalling [${options.removalOf.join(' ')}] did more than remove:`);
      console.error(violations.map((v) => `  - ${describe(v)} — ${v.why}`).join('\n'));
      process.exitCode = 1;
    }
    return;
  }

  const result = classifyDrift(before, after, options.allow);

  const problems = [];
  for (const item of result.unexpected) {
    problems.push(`${describe(item)} — not one of [${options.allow.join(' ')}] and not a dependency of one`);
  }
  for (const change of result.rootRanges.filter((entry) => !entry.allowed)) {
    problems.push(`package.json ${change.block}.${change.name}: ${change.from} -> ${change.to} — not a named package`);
  }
  for (const field of result.rootOther) {
    problems.push(`the lockfile's root entry changed field "${field}"`);
  }
  for (const name of options.single) {
    const copies = copiesOf(after, name);
    if (copies.length !== 1) {
      problems.push(`${copies.length} copies of ${name} (${copies.join(', ') || 'none'}) — must be exactly one`);
    }
  }
  const peers = [];
  for (const spec of options.peer) {
    const [dependent, peer] = spec.split(':');
    let verdict;
    try {
      verdict = checkPeer(after, dependent, peer);
    } catch (error) {
      problems.push(`peer ${spec}: ${error.message}`);
      continue;
    }
    peers.push(verdict);
    if (verdict.status === 'unmet') {
      problems.push(`${dependent} peers ${peer} "${verdict.range}" but the tree has ${verdict.version ?? 'none'}`);
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ ...result, peers, problems }, null, 2));
  } else {
    for (const item of result.expected) console.log(describe(item));
    for (const change of result.rootRanges) {
      console.log(`package.json ${change.block}.${change.name} ${change.from ?? 'absent'}->${change.to ?? 'removed'}`);
    }
    for (const verdict of peers) {
      if (verdict.status === 'ok') console.error(`  peer ok: ${verdict.dependent} wants ${verdict.peer} ${verdict.range}, tree has ${verdict.version}`);
    }
  }

  if (problems.length > 0) {
    console.error(`lockfile drift is NOT confined to [${options.allow.join(' ')}]:`);
    console.error(problems.map((problem) => `  - ${problem}`).join('\n'));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
