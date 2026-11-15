import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// builder/scanners/dependencies.mjs — buildmill's STANDARD dependency scanner,
// byte for byte (advisories, "dependency update:", "dependency major behind:").
// The cms-only peer check lives in peer-ranges.mjs (tests/scripts/peerRanges.spec.js).
// The scanner has no exports and runs on import, so it is driven as a subprocess
// with a stub `npm` on PATH answering `audit` and `view`: hermetic, no network.
// Equality with buildmill's copy needs the network, so the template block pins
// marker lines instead.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCANNER = path.join(ROOT, 'builder/scanners/dependencies.mjs');
const HOLDS = path.join(ROOT, 'builder/dependency-holds.json');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// ---------------------------------------------------------------- npm stub

// STUB_NPM_MODE: ok | garbage | error | hang | viewfail. A name absent from views.json is an E404.
const NPM_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const mode = process.env.STUB_NPM_MODE || 'ok';
const dir = __dirname;
const sub = args[0];
if (sub === 'audit') {
  if (mode === 'hang') {
    setInterval(() => {}, 1000);
  } else if (mode === 'garbage') {
    process.stderr.write('npm ERR! something exploded\\n');
    process.stdout.write('this is not json');
    process.exit(1);
  } else if (mode === 'error') {
    process.stdout.write(JSON.stringify({ error: { code: 'ENOAUDIT', summary: 'audit endpoint unreachable' } }));
    process.exit(1);
  } else {
    const text = fs.readFileSync(path.join(dir, 'audit.json'), 'utf8');
    process.stdout.write(text);
    const report = JSON.parse(text);
    process.exit(Object.keys(report.vulnerabilities || {}).length ? 1 : 0);
  }
} else if (sub === 'view') {
  const dash = args.indexOf('--');
  const name = dash === -1 ? args.filter((a) => !a.startsWith('-'))[1] : args[dash + 1];
  if (mode === 'viewfail') {
    process.stdout.write(JSON.stringify({ error: { code: 'ECONNREFUSED', summary: 'registry unreachable' } }));
    process.exit(1);
  }
  const views = JSON.parse(fs.readFileSync(path.join(dir, 'views.json'), 'utf8'));
  if (Object.prototype.hasOwnProperty.call(views, name)) {
    process.stdout.write(JSON.stringify(views[name]));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ error: { code: 'E404', summary: 'not found' } }));
  process.exit(1);
} else {
  process.exit(1);
}
`;

// ------------------------------------------------------------ audit fixtures

const GHSA_MODERATE = 'GHSA-w74x-v6f9-j3xg';
const GHSA_LOW = 'GHSA-xhq7-xmqj-769h';

function advisory(source, name, ghsa, severity, range, title) {
  return {
    source,
    name,
    dependency: name,
    title,
    url: `https://github.com/advisories/${ghsa}`,
    severity,
    cwe: [],
    cvss: { score: 0, vectorString: '' },
    range,
  };
}

function vuln(name, severity, via, nodes, extra = {}) {
  return {
    name,
    severity,
    isDirect: false,
    via,
    effects: [],
    range: '*',
    nodes,
    fixAvailable: true,
    ...extra,
  };
}

// fast-uri reached through ajv; the inheriting `ajv` entry's `via` is the string "fast-uri".
const fastUriVulns = () => ({
  'fast-uri': vuln(
    'fast-uri',
    'moderate',
    [
      advisory(1, 'fast-uri', GHSA_MODERATE, 'moderate', '>=3.0.0 <3.1.9', 'fast-uri scheme spoofing'),
      advisory(2, 'fast-uri', GHSA_LOW, 'low', '>=3.0.0 <3.1.9', 'fast-uri path equivalence'),
    ],
    ['node_modules/fast-uri'],
    { effects: ['ajv'], range: '3.0.0 - 3.1.8' },
  ),
  ajv: vuln('ajv', 'moderate', ['fast-uri'], ['node_modules/ajv'], {
    fixAvailable: { name: 'ajv', version: '8.21.0', isSemVerMajor: false },
  }),
});

const report = (vulnerabilities) => ({ auditReportVersion: 2, vulnerabilities, metadata: {} });
const CLEAN_REPORT = report({});

// --------------------------------------------------------------- repo fixture

const CMS_PACKAGE = () => ({
  name: '@koehler8/cms',
  version: '1.4.2',
  dependencies: { ajv: '^8.20.0' },
  devDependencies: { vite: '^8.3.0', vue: '^3.5.43' },
  peerDependencies: { vite: '^8.0.0', vue: '^3.5.0' },
});

const lockEntry = (version, extra = {}) => ({
  version,
  resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
  integrity: 'sha512-x',
  ...extra,
});

const CMS_LOCK = (pkg = CMS_PACKAGE()) => ({
  name: pkg.name,
  version: pkg.version,
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: pkg.name,
      version: pkg.version,
      dependencies: pkg.dependencies,
      devDependencies: pkg.devDependencies,
      peerDependencies: pkg.peerDependencies,
    },
    'node_modules/ajv': lockEntry('8.20.0', { dependencies: { 'fast-uri': '^3.0.1' } }),
    'node_modules/fast-uri': lockEntry('3.1.8'),
    'node_modules/rt-high': lockEntry('2.0.0'),
    'node_modules/rt-mod': lockEntry('1.0.0'),
    'node_modules/rt-low': lockEntry('1.0.0'),
    'node_modules/dev-only': lockEntry('4.0.0', { dev: true }),
    'node_modules/dev-opt': lockEntry('1.0.0', { devOptional: true }),
    'node_modules/vite': lockEntry('8.3.0', { dev: true, peer: true }),
    'node_modules/vue': lockEntry('3.5.43', { dev: true, peer: true }),
  },
});

// Default registry: nothing newer than installed, so a clean tree stays clean.
const NO_NEWER = { ajv: ['8.20.0'], vite: ['8.3.0'], vue: ['3.5.43'] };

const tmpDirs = [];

function makeDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

function stubBin({ audit = CLEAN_REPORT, views = NO_NEWER } = {}) {
  const bin = makeDir('cms-depscan-bin-');
  writeFileSync(path.join(bin, 'npm'), NPM_STUB);
  chmodSync(path.join(bin, 'npm'), 0o755);
  writeFileSync(path.join(bin, 'audit.json'), JSON.stringify(audit));
  writeFileSync(path.join(bin, 'views.json'), JSON.stringify(views));
  return bin;
}

function spawnScanner({ cwd, bin, mode = 'ok', env = {}, timeout = 20000 }) {
  const res = spawnSync(process.execPath, [SCANNER], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      STUB_NPM_MODE: mode,
      ...env,
    },
  });
  let findings;
  try {
    findings = JSON.parse(res.stdout);
  } catch {
    findings = undefined;
  }
  return { status: res.status, findings, stdout: res.stdout, stderr: res.stderr };
}

// Run the scanner in a throwaway clone; `findings` is the parsed stdout.
function runScanner({
  pkg = CMS_PACKAGE(),
  lock = CMS_LOCK(pkg),
  audit = CLEAN_REPORT,
  views = NO_NEWER,
  holds,
  mode = 'ok',
  env = {},
  timeout = 20000,
} = {}) {
  const repo = makeDir('cms-depscan-repo-');
  if (pkg !== null) writeFileSync(path.join(repo, 'package.json'), JSON.stringify(pkg, null, 2));
  if (lock !== null) {
    writeFileSync(
      path.join(repo, 'package-lock.json'),
      typeof lock === 'string' ? lock : JSON.stringify(lock, null, 2),
    );
  }
  if (holds !== undefined) {
    mkdirSync(path.join(repo, 'builder'), { recursive: true });
    writeFileSync(
      path.join(repo, 'builder/dependency-holds.json'),
      typeof holds === 'string' ? holds : JSON.stringify(holds),
    );
  }
  return spawnScanner({ cwd: repo, bin: stubBin({ audit, views }), mode, env, timeout });
}

const text = (f) => `${f.title}\n${f.detail}`;
const mentioning = (findings, needle) => findings.filter((f) => text(f).includes(needle));
const blindFindings = (findings) => findings.filter((f) => /dependency scanner blind/i.test(f.title));
const titled = (findings, start) => findings.filter((f) => f.title.startsWith(start));

// -------------------------------------------------- the file and its contract

describe('dependencies scanner — the standard buildmill template', () => {
  const source = () => readFileSync(SCANNER, 'utf8');

  // Stand-ins for the equality check against koehler8/buildmill (needs the
  // network): the marker lines that make the file the template, not a cms adaptation.
  it('exists, declares itself the onboarding template, and keeps the template-safe subset', () => {
    expect(existsSync(SCANNER)).toBe(true);
    expect(source()).toContain('This file is the onboarding template');
    expect(source()).toContain('DEPENDENCY_SCANNER_TEMPLATE');
    expect(source()).not.toContain('`');
    expect(source()).not.toContain('${');
  });

  it('reads holds from builder/dependency-holds.json and carries the template titles', () => {
    const src = source();
    expect(src).toMatch(/HOLDS_FILE\s*=\s*join\(\s*"builder"\s*,\s*"dependency-holds\.json"\s*\)/);
    for (const t of ['advisory', 'update', 'major behind', 'scanner blind', 'holds invalid']) {
      expect(src).toContain(`dependency ${t}: `);
    }
  });

  it('has no cms-only logic: no peer-range check, no package-name guard, no exports', () => {
    const src = source();
    expect(src).not.toMatch(/peer/i);
    expect(src).not.toContain('@koehler8/cms');
    expect(src).not.toMatch(/^export\s/m);
  });
});

describe('builder/dependency-holds.json', () => {
  it('exists and is a JSON array; every entry carries package, range and a reason', () => {
    const holds = JSON.parse(readFileSync(HOLDS, 'utf8'));
    expect(Array.isArray(holds)).toBe(true);
    for (const h of holds) expect([typeof h.package, typeof h.range, h.reason?.trim().length > 0]).toEqual(['string', 'string', true]);
  });
});

// --------------------------------------------------------------- this repo

describe('dependencies scanner — on this repo', () => {
  // The real package.json, lockfile and holds file, with npm stubbed: the
  // done-when check (a JSON array, every title ending (cms), not blind).
  const realRoot = (views) => spawnScanner({ cwd: ROOT, bin: stubBin({ views }) });

  it('prints a JSON array, exits 0, every title ends (cms), and is not blind or holds-invalid', () => {
    const { status, findings, stderr } = realRoot({});
    expect(status).toBe(0);
    expect(Array.isArray(findings), `stdout was not a JSON array. stderr: ${stderr}`).toBe(true);
    expect(blindFindings(findings)).toEqual([]);
    expect(findings.filter((f) => /dependency holds invalid/i.test(f.title))).toEqual([]);
    for (const f of findings) expect(f.title).toMatch(/\(cms\)$/);
  });

  it('files "dependency update:" for a newer in-major release of a direct dependency, and nothing about peers', () => {
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages;
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const name = Object.keys(pkg.dependencies || {}).find((n) => /^\d+\.\d+\.\d+$/.test((lock[`node_modules/${n}`] || {}).version));
    expect(name, 'no plain-versioned direct dependency to probe with').toBeTruthy();
    const [major, minor, patch] = lock[`node_modules/${name}`].version.split('.').map(Number);
    const newer = `${major}.${minor}.${patch + 1000}`;

    const { findings } = realRoot({ [name]: [lock[`node_modules/${name}`].version, newer] });
    const hit = findings.filter((f) => f.title === `dependency update: ${name} (cms)`);
    expect(hit).toHaveLength(1);
    expect(hit[0].severity).toBe('info');
    expect(hit[0].detail).toContain(newer);
    expect(blindFindings(findings)).toEqual([]);
    expect(findings.filter((f) => /peer/i.test(f.title))).toEqual([]);
  });
});

// ------------------------------------------------------------------- advisories

describe('dependencies scanner — runtime and dev-tree advisories', () => {
  const one = (name, level, ghsa, extra) => ({
    [name]: vuln(name, level, [advisory(1, name, ghsa, level, '<9.9.9', `${name} bad`)], [`node_modules/${name}`], extra),
  });
  const sevOf = (vulns, ghsa) => {
    const hit = mentioning(runScanner({ audit: report(vulns) }).findings, ghsa);
    expect(hit, `one finding mentions ${ghsa}`).toHaveLength(1);
    return hit[0];
  };

  it('reports a runtime advisory (fast-uri via ajv) with its ids, once, and exits 0', () => {
    const { status, findings, stderr } = runScanner({ audit: report(fastUriVulns()) });
    expect(status).toBe(0);
    expect(Array.isArray(findings), `stdout was not a JSON array. stderr: ${stderr}`).toBe(true);
    const combined = findings.filter((f) => f.title.includes('fast-uri')).map(text).join('\n');
    expect(combined).toContain(GHSA_MODERATE);
    expect(combined).toContain(GHSA_LOW);
    expect(combined).toContain('3.1.8');
    // ajv merely inherits the advisory: no finding of its own
    expect(titled(findings, 'dependency advisory:').filter((f) => f.title.includes('ajv'))).toEqual([]);
    for (const f of findings) expect(SEVERITIES).toContain(f.severity);
  });

  it('files a runtime advisory at its level (high → high), a critical/high dev-only one as medium (naming the dev-only tree), a moderate one as low', () => {
    expect(sevOf(one('rt-high', 'high', 'GHSA-h1h1-aaaa-0001'), 'GHSA-h1h1-aaaa-0001').severity).toBe('high');
    const hit = sevOf(one('dev-only', 'high', 'GHSA-d3d3-dddd-0004'), 'GHSA-d3d3-dddd-0004');
    expect(hit.severity).toBe('medium');
    expect(hit.detail).toMatch(/dev-only tree/);
    expect(sevOf(one('dev-only', 'moderate', 'GHSA-d1d1-ffff-0006'), 'GHSA-d1d1-ffff-0006').severity).toBe('low');
  });

  it('uses stable titles: no dates or counts, and the same set across two runs of the same tree', () => {
    // audit and the update checks run concurrently, so only the order may differ
    const opts = { audit: report(fastUriVulns()), views: { ...NO_NEWER, ajv: ['8.20.0', '8.21.0'] } };
    const a = runScanner(opts).findings.map((f) => f.title).sort();
    const b = runScanner(opts).findings.map((f) => f.title).sort();
    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    for (const title of a) {
      expect(title).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      expect(title).not.toMatch(/\b\d+ (advisor|vulnerabilit|finding|package)/i);
    }
  });

  it('prints [] and exits 0 for a tree with no advisories and nothing newer on the registry', () => {
    const { status, findings, stdout } = runScanner();
    expect(status).toBe(0);
    expect(findings).toEqual([]);
    expect(stdout.trim()).toBe('[]');
  });
});

// ---------------------------------------------------------------------- updates

describe('dependencies scanner — updates', () => {
  it('files "dependency update: <pkg> (cms)" as info for a newer release inside the installed major', () => {
    const { status, findings } = runScanner({ views: { ...NO_NEWER, ajv: ['8.20.0', '8.21.0', '8.22.3'] } });
    expect(status).toBe(0);
    const hit = titled(findings, 'dependency update:');
    expect(hit).toHaveLength(1);
    expect(hit[0].title).toBe('dependency update: ajv (cms)');
    expect(hit[0].severity).toBe('info');
    expect(hit[0].detail).toContain('8.22.3'); // the highest stable release
    expect(hit[0].proposedChange).toContain('8.22.3');
  });

  it('files "dependency major behind: <pkg> N.x → M.x (cms)" as low when a newer major exists', () => {
    const { findings } = runScanner({ views: { ...NO_NEWER, vue: ['3.5.43', '4.0.0', '4.1.2'] } });
    const hit = titled(findings, 'dependency major behind:');
    expect(hit).toHaveLength(1);
    expect(hit[0].title).toBe('dependency major behind: vue 3.x → 4.x (cms)');
    expect(hit[0].severity).toBe('low');
    expect(hit[0].detail).toContain('4.1.2');
  });

  it('never targets a prerelease or a lower version, and files nothing for an E404 package', () => {
    const pre = runScanner({ views: { ...NO_NEWER, vue: ['3.4.0', '3.5.43', '4.0.0-beta.1'], vite: ['7.0.0', '8.3.0', '8.4.0-rc.1'] } });
    expect(titled(pre.findings, 'dependency')).toEqual([]);
    expect(runScanner({ views: {} }).findings).toEqual([]);
  });
});

// ------------------------------------------------------------ never silently blind

describe('dependencies scanner — never silently blind', () => {
  const blindOf = (opts) => {
    const { status, findings, stderr } = runScanner(opts);
    expect(status, `scanner must exit 0 even when blind. stderr: ${stderr}`).toBe(0);
    const blind = blindFindings(findings ?? []);
    expect(blind.length, 'a blind scanner must not print []').toBeGreaterThanOrEqual(1);
    expect(blind[0].severity).toBe('medium');
    expect(blind[0].detail.length).toBeGreaterThan(0);
    expect(blind[0].title).toMatch(/^dependency scanner blind: .+ \(cms\)$/);
    expect(findings.filter((f) => /peer-range scanner blind/i.test(f.title))).toEqual([]); // that title is peer-ranges.mjs's
    return blind[0].title;
  };

  it('files a "dependency scanner blind" finding for each cause, instead of printing []', () => {
    const causes = {
      'no lockfile': { lock: null },
      'unparsable lockfile': { lock: '{ not json' },
      'unreadable audit output': { mode: 'garbage' },
      'audit error object instead of a report': { mode: 'error' },
      'unreachable registry': { mode: 'viewfail' },
    };
    const seen = Object.entries(causes).map(([label, opts]) => [label, blindOf(opts)]);
    expect(blindOf({ lock: null })).toBe(seen[0][1]); // stable across runs
    expect(seen[0][1]).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(seen[0][1]).not.toBe(seen[1][1]); // each cause has its own title
  });

  it('files a blind finding when the time budget runs out, instead of printing []', () => {
    const title = blindOf({ mode: 'hang', env: { BUILDMILL_DEPENDENCY_SCANNER_BUDGET_MS: '400' }, timeout: 15000 });
    expect(title).toBe('dependency scanner blind: time budget exhausted (cms)');
  }, 20000);
});

// ------------------------------------------------------------------------ holds

describe('dependencies scanner — builder/dependency-holds.json', () => {
  const VUE_UP = { ...NO_NEWER, vue: ['3.5.43', '3.5.44'] };
  const invalid = (findings) => findings.filter((f) => /^dependency holds invalid: /.test(f.title));

  it('silences updates for a held package only while the installed version is inside the hold range', () => {
    const hold = (range) => [{ package: 'vue', range, reason: 'peer-linked to the framework floor' }];
    const held = runScanner({ views: { ...VUE_UP, ajv: ['8.20.0', '8.21.0'] }, holds: hold('3.x') }).findings;
    expect(held.filter((f) => /\bvue\b/.test(f.title))).toEqual([]);
    expect(titled(held, 'dependency update: ajv')).toHaveLength(1); // the hold is per package
    expect(titled(runScanner({ views: VUE_UP, holds: hold('2.x') }).findings, 'dependency update: vue')).toHaveLength(1);
  });

  it('silences an accepted GHSA id while the installed version is inside the hold range, and still files the others on that package', () => {
    const hold = (range) => [{ package: 'fast-uri', range, reason: 'no fixed release yet', acceptedAdvisories: [GHSA_MODERATE] }];
    const fastUri = (holds) => {
      const { findings } = runScanner({ audit: report(fastUriVulns()), holds });
      expect(invalid(findings)).toEqual([]);
      return findings.filter((f) => f.title.includes('fast-uri')).map(text).join('\n');
    };
    const held = fastUri(hold('3.x')); // fast-uri 3.1.8 is installed
    expect(held).not.toContain(GHSA_MODERATE);
    expect(held).toContain(GHSA_LOW);
    expect(fastUri(hold('4.x'))).toContain(GHSA_MODERATE); // outside the range: not honoured
  });

  it('honours no hold without a reason: files "holds invalid" (medium), and still files what it tried to silence', () => {
    const { findings } = runScanner({
      audit: report(fastUriVulns()),
      holds: [{ package: 'fast-uri', range: '3.x', acceptedAdvisories: [GHSA_MODERATE] }],
    });
    expect(findings.map(text).join('\n')).toContain(GHSA_MODERATE);
    expect(invalid(findings)).toHaveLength(1);
    expect(invalid(findings)[0].severity).toBe('medium');
    expect(invalid(findings)[0].title).toMatch(/\(cms\)$/);
    expect(invalid(runScanner({ holds: '{ not json' }).findings)).toHaveLength(1);
  });

  it('an empty holds file ([]) is valid and files nothing of its own', () => {
    expect(runScanner({ holds: [] })).toMatchObject({ status: 0, findings: [] });
  });
});

// ---------------------------------------------------------------- policy text
//
// The observer's instructions are the other half of this item. Loosely worded
// on purpose: the prose can be reworked, the rules cannot silently flip back.
describe('observer policy text', () => {
  const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ');
  const between = (md, from, to) => {
    const rest = md.indexOf(from) === -1 ? '' : md.slice(md.indexOf(from));
    const end = rest.indexOf(to, from.length);
    return end === -1 ? rest : rest.slice(0, end);
  };
  const sentences = (md) => md.split(/(?<=[.!?])\s+/);
  const brief = read('builder/phases/observe.md');
  const facet = read('builder/observe.md');
  // "outdated"/"bump" is "never a finding" without saying whose: the scanner's
  // and the passes' sentences are the rewritten rule and are allowed.
  const flatExclusions = (md) =>
    sentences(md).filter(
      (s) =>
        /outdated|bump/i.test(s) && /\b(never|not)\b/i.test(s) && /finding/i.test(s) &&
        !/scanner|dependency update|major behind|own pass|passes|model/i.test(s),
    );

  it('phases/observe.md priority 4 attributes advisories to dependencies.mjs (dev-only critical/high is medium) and peer gaps to peer-ranges.mjs', () => {
    const p4 = between(brief, '4. **Dependency', '5. **Release');
    expect(p4.length, 'priority 4 (Dependency defects) not found').toBeGreaterThan(0);
    expect(p4).toContain('builder/scanners/dependencies.mjs');
    expect(p4).toContain('builder/scanners/peer-ranges.mjs');
    expect(p4).toMatch(/peer-ranges\.mjs[^.]*peer|peer[^.]*peer-ranges\.mjs/i);
    expect(p4).toMatch(/dev-only[^.]*medium|medium[^.]*dev-only/i);
    expect(p4).not.toMatch(/dev tree[^.]*(never ships|not a finding)/i);
  });

  it('phases/observe.md lets the scanner\'s update and major-behind findings stand; the model\'s passes still never propose a bump', () => {
    expect(brief).toContain('dependency update:');
    expect(brief).toContain('dependency major behind:');
    expect(flatExclusions(brief)).toEqual([]);
    expect(sentences(brief).filter((s) => /bump/i.test(s) && /\b(never|not)\b/i.test(s)).length).toBeGreaterThanOrEqual(1);
    // regression guard: the by-design non-findings stay
    expect(brief).toMatch(/consumer sites[^.]*(lagging|older pin)/i);
    expect(brief).toMatch(/beta\.N/);
  });

  it('observe.md source 5 names both scanners and what each reports; Boundaries no longer flatly exclude outdated packages', () => {
    const s5 = between(facet.slice(Math.max(0, facet.search(/\b5\. \*\*[^*]*dependenc/i))), '5.', '## Read-only');
    for (const needle of ['dependencies.mjs', 'peer-ranges.mjs', 'dependency update:', 'dependency major behind:', 'peer-range scanner blind', 'dependency scanner blind']) {
      expect(s5, `source 5 (the dependency scanners) mentions ${needle}`).toContain(needle);
    }
    const boundaries = between(facet, '## Boundaries', ' ## ');
    expect(boundaries).toMatch(/advisor/i);
    expect(boundaries).toMatch(/dependency update|major behind|scanner/i);
    expect(flatExclusions(boundaries)).toEqual([]);
  });

  it('observe.md Coverage block requires the dependency scanner with a through-timestamp; both facets are present tense, no dates', () => {
    const coverage = between(facet, '## Coverage block', ' ## ');
    expect(coverage).toMatch(/dependenc/i);
    expect(coverage).toMatch(/timestamp/i);
    for (const md of [facet, brief]) expect(md).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });
});
