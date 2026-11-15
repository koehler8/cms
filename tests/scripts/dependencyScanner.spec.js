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
// carried byte for byte (the file says so itself: "This file is the onboarding
// template"). It reports advisories, newer in-major releases ("dependency
// update:") and newer majors ("dependency major behind:"). The cms-only
// peer-range check lives in builder/scanners/peer-ranges.mjs and is covered by
// tests/scripts/peerRanges.spec.js.
//
// This spec drives the scanner the way the buildmill runner does: as a
// subprocess whose cwd is a clone, reading a JSON array of
// { title, detail, severity, proposedChange } from stdout. The scanner has no
// exports and runs on import, so a subprocess is the only surface. `npm` is
// replaced by a stub on PATH that answers `npm audit` and `npm view` with
// canned data, so nothing here touches the network and nothing depends on
// today's advisories or today's registry.
//
// Whether the file equals buildmill's copy cannot be asserted without the
// network, so the "template contract" block pins the marker lines instead.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCANNER = path.join(ROOT, 'builder/scanners/dependencies.mjs');
const HOLDS = path.join(ROOT, 'builder/dependency-holds.json');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// ---------------------------------------------------------------- npm stub

// Mimics the two npm calls the standard scanner makes:
//   npm audit --json --package-lock-only   canned report from audit.json (exit 1
//                                          when it lists vulnerabilities, like npm)
//   npm view --json -- <name> versions     the list under <name> in views.json;
//                                          a name with no entry is an E404, like
//                                          a package the registry does not know
// STUB_NPM_MODE: ok | garbage | error | hang | viewfail
const NPM_STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const mode = process.env.STUB_NPM_MODE || 'ok';
const dir = __dirname;
const sub = args[0];
if (sub === 'audit') {
  if (mode === 'hang') {
    setTimeout(() => {}, 60000);
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
const GHSA_HIGH = 'GHSA-h1h1-aaaa-0001';
const GHSA_MOD2 = 'GHSA-m0m0-bbbb-0002';
const GHSA_LOW2 = 'GHSA-l0l0-cccc-0003';
const GHSA_DEV = 'GHSA-d3d3-dddd-0004';
const GHSA_DEVOPT = 'GHSA-d0d0-eeee-0005';
const GHSA_DEVMOD = 'GHSA-d1d1-ffff-0006';

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

// The shape of the real finding that motivated the first scanner: fast-uri
// reached through ajv, with the inheriting `ajv` entry whose `via` is just the
// string "fast-uri".
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

// What the registry "knows" in a default run: nothing newer than installed, so
// a clean tree stays clean unless a test says otherwise.
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

// Run the scanner in a throwaway "clone". Returns { status, findings, stdout,
// stderr }. `findings` is the parsed stdout (undefined if it was not JSON).
function runScanner({
  pkg = CMS_PACKAGE(),
  lock = CMS_LOCK(pkg),
  audit = CLEAN_REPORT,
  views = NO_NEWER,
  holds,
  mode = 'ok',
  env = {},
  timeout = 20000,
  origin,
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
  if (origin) {
    const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    git('remote', 'add', 'origin', origin);
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

  it('exists where the runner looks for it', () => {
    expect(existsSync(SCANNER)).toBe(true);
  });

  // The equality check against koehler8/buildmill needs the network, so these
  // marker lines stand in for it: they are what makes the file the template
  // rather than a cms adaptation of it.
  it('declares itself the onboarding template, carried byte for byte', () => {
    expect(source()).toContain('This file is the onboarding template');
    expect(source()).toContain('DEPENDENCY_SCANNER_TEMPLATE');
  });

  it('keeps the template-safe subset: no backtick and no dollar-brace sequence', () => {
    expect(source()).not.toContain('`');
    expect(source()).not.toContain('${');
  });

  it('reads holds from builder/dependency-holds.json', () => {
    expect(source()).toMatch(/HOLDS_FILE\s*=\s*join\(\s*"builder"\s*,\s*"dependency-holds\.json"\s*\)/);
  });

  it('has no cms-only logic: no peer-range check, no package-name guard, no exports', () => {
    const src = source();
    expect(src).not.toMatch(/peer/i);
    expect(src).not.toContain('@koehler8/cms');
    expect(src).not.toMatch(/^export\s/m);
  });

  it('carries the update and major-behind classifiers the template defines', () => {
    const src = source();
    expect(src).toContain('dependency update: ');
    expect(src).toContain('dependency major behind: ');
    expect(src).toContain('dependency scanner blind: ');
    expect(src).toContain('dependency holds invalid: ');
    expect(src).toContain('dependency advisory: ');
  });
});

describe('builder/dependency-holds.json', () => {
  it('exists and is a JSON array; every entry carries package, range and reason', () => {
    expect(existsSync(HOLDS)).toBe(true);
    const holds = JSON.parse(readFileSync(HOLDS, 'utf8'));
    expect(Array.isArray(holds)).toBe(true);
    for (const h of holds) {
      expect(typeof h.package).toBe('string');
      expect(typeof h.range).toBe('string');
      expect(typeof h.reason).toBe('string');
      expect(h.reason.trim().length).toBeGreaterThan(0);
    }
  });
});

// --------------------------------------------------------------- this repo

describe('dependencies scanner — on this repo', () => {
  // The real package.json, lockfile and holds file, with npm stubbed so the
  // run is hermetic. This is the done-when check: a JSON array, every title
  // ending (cms), no blind and no holds-invalid finding.
  const realRoot = (views, audit = CLEAN_REPORT) =>
    spawnScanner({ cwd: ROOT, bin: stubBin({ audit, views }) });

  const lockPackages = () => JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages;
  const rootPackage = () => JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  it('prints a JSON array, exits 0, every title ends (cms), and is not blind or holds-invalid', () => {
    const { status, findings, stderr } = realRoot({});
    expect(status).toBe(0);
    expect(Array.isArray(findings), `stdout was not a JSON array. stderr: ${stderr}`).toBe(true);
    expect(blindFindings(findings)).toEqual([]);
    expect(findings.filter((f) => /dependency holds invalid/i.test(f.title))).toEqual([]);
    for (const f of findings) expect(f.title).toMatch(/\(cms\)$/);
  });

  it('files a "dependency update:" finding when the registry offers a newer in-major release of a direct dependency', () => {
    const lock = lockPackages();
    const pkg = rootPackage();
    const name = Object.keys(pkg.dependencies || {}).find((n) => {
      const v = (lock[`node_modules/${n}`] || {}).version;
      return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
    });
    expect(name, 'no plain-versioned direct dependency to probe with').toBeTruthy();
    const [major, minor, patch] = lock[`node_modules/${name}`].version.split('.').map(Number);
    const newer = `${major}.${minor}.${patch + 1000}`;

    const { findings } = realRoot({ [name]: [lock[`node_modules/${name}`].version, newer] });
    const hit = findings.filter((f) => f.title === `dependency update: ${name} (cms)`);
    expect(hit).toHaveLength(1);
    expect(hit[0].severity).toBe('info');
    expect(hit[0].detail).toContain(newer);
    expect(blindFindings(findings)).toEqual([]);
  });

  it('files nothing about peerDependencies: the peer-range check is not in this scanner', () => {
    const { findings } = realRoot({});
    expect(findings.filter((f) => /peer/i.test(f.title))).toEqual([]);
  });
});

// ------------------------------------------------------------------- the run

describe('dependencies scanner — runtime and dev-tree advisories', () => {
  it('reports a runtime advisory (fast-uri via ajv) with its advisory ids, and exits 0', () => {
    const { status, findings, stderr } = runScanner({ audit: report(fastUriVulns()) });

    expect(status).toBe(0);
    expect(Array.isArray(findings), `stdout was not a JSON array. stderr: ${stderr}`).toBe(true);

    const fastUri = findings.filter((f) => f.title.includes('fast-uri'));
    expect(fastUri.length).toBeGreaterThanOrEqual(1);
    const combined = fastUri.map(text).join('\n');
    expect(combined).toContain(GHSA_MODERATE);
    expect(combined).toContain(GHSA_LOW);
    expect(combined).toContain('3.1.8');
  });

  it('keeps the {title, detail, severity} contract on every finding', () => {
    const { findings } = runScanner({
      audit: report(fastUriVulns()),
      views: { ...NO_NEWER, vue: ['3.5.43', '4.0.0'] },
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(typeof f.title).toBe('string');
      expect(f.title.length).toBeGreaterThan(0);
      expect(typeof f.detail).toBe('string');
      expect(f.detail.length).toBeGreaterThan(0);
      expect(SEVERITIES).toContain(f.severity);
    }
  });

  it('does not file a second finding for a package that merely inherits the advisory (ajv → fast-uri)', () => {
    const { findings } = runScanner({ audit: report(fastUriVulns()) });
    expect(titled(findings, 'dependency advisory:').filter((f) => f.title.includes('ajv'))).toEqual([]);
  });

  it('maps advisory level to severity: high → high, moderate → low, low → info', () => {
    const vulnerabilities = {
      'rt-high': vuln('rt-high', 'high', [advisory(10, 'rt-high', GHSA_HIGH, 'high', '<2.0.1', 'rt-high bad')], [
        'node_modules/rt-high',
      ]),
      'rt-mod': vuln('rt-mod', 'moderate', [advisory(11, 'rt-mod', GHSA_MOD2, 'moderate', '<1.0.1', 'rt-mod bad')], [
        'node_modules/rt-mod',
      ]),
      'rt-low': vuln('rt-low', 'low', [advisory(12, 'rt-low', GHSA_LOW2, 'low', '<1.0.1', 'rt-low bad')], [
        'node_modules/rt-low',
      ]),
    };
    const { findings } = runScanner({ audit: report(vulnerabilities) });

    const sev = (needle) => {
      const hit = mentioning(findings, needle);
      expect(hit.length, `no finding mentions ${needle}`).toBeGreaterThanOrEqual(1);
      return hit[0].severity;
    };
    expect(sev('rt-high')).toBe('high');
    expect(sev('rt-mod')).toBe('low');
    expect(sev('rt-low')).toBe('info');
  });

  it('files a critical/high advisory that exists only in the dev tree as medium, naming the dev-only tree', () => {
    const devOnly = {
      'dev-only': vuln('dev-only', 'high', [advisory(20, 'dev-only', GHSA_DEV, 'high', '<4.0.1', 'dev-only bad')], [
        'node_modules/dev-only',
      ]),
    };
    const { findings } = runScanner({ audit: report(devOnly) });
    const hit = mentioning(findings, GHSA_DEV);
    expect(hit).toHaveLength(1);
    expect(hit[0].severity).toBe('medium');
    expect(hit[0].detail).toMatch(/dev-only tree/);
  });

  it('keeps a moderate dev-only advisory at low, not medium', () => {
    const devMod = {
      'dev-only': vuln('dev-only', 'moderate', [advisory(21, 'dev-only', GHSA_DEVMOD, 'moderate', '<4.0.1', 'dev-only meh')], [
        'node_modules/dev-only',
      ]),
    };
    const { findings } = runScanner({ audit: report(devMod) });
    const hit = mentioning(findings, GHSA_DEVMOD);
    expect(hit).toHaveLength(1);
    expect(hit[0].severity).toBe('low');
  });

  it('treats a devOptional package as runtime: a critical/high advisory there is high', () => {
    const devOpt = {
      'dev-opt': vuln('dev-opt', 'critical', [advisory(22, 'dev-opt', GHSA_DEVOPT, 'critical', '<1.0.1', 'dev-opt bad')], [
        'node_modules/dev-opt',
      ]),
    };
    const { findings } = runScanner({ audit: report(devOpt) });
    const hit = mentioning(findings, GHSA_DEVOPT);
    expect(hit).toHaveLength(1);
    expect(hit[0].severity).toBe('high');
  });

  it('files the runtime advisory and the dev-only one side by side, each at its own severity', () => {
    const devOnly = {
      'dev-only': vuln('dev-only', 'high', [advisory(20, 'dev-only', GHSA_DEV, 'high', '<4.0.1', 'dev-only bad')], [
        'node_modules/dev-only',
      ]),
    };
    const { findings } = runScanner({ audit: report({ ...fastUriVulns(), ...devOnly }) });
    expect(mentioning(findings, GHSA_MODERATE)[0].severity).toBe('low');
    expect(mentioning(findings, GHSA_DEV)[0].severity).toBe('medium');
  });

  it('never proposes a version below the installed one', () => {
    const downgrade = {
      'rt-high': vuln(
        'rt-high',
        'high',
        [advisory(10, 'rt-high', GHSA_HIGH, 'high', '<2.0.1', 'rt-high bad')],
        ['node_modules/rt-high'],
        { fixAvailable: { name: 'rt-high', version: '1.0.0', isSemVerMajor: true } },
      ),
    };
    const { findings } = runScanner({ audit: report(downgrade) });
    const hit = mentioning(findings, GHSA_HIGH);
    expect(hit).toHaveLength(1);
    expect(hit[0].proposedChange).toMatch(/no non-downgrade fix/i);
    expect(hit[0].proposedChange).not.toContain('1.0.0');
  });

  it('prints [] and exits 0 for a tree with no advisories and nothing newer on the registry', () => {
    const { status, findings, stdout } = runScanner();
    expect(status).toBe(0);
    expect(findings).toEqual([]);
    expect(stdout.trim()).toBe('[]');
  });
});

describe('dependencies scanner — updates', () => {
  it('files "dependency update: <pkg> (cms)" as info for a newer release inside the installed major', () => {
    const { status, findings } = runScanner({ views: { ...NO_NEWER, ajv: ['8.20.0', '8.21.0', '8.22.3'] } });
    expect(status).toBe(0);
    const hit = titled(findings, 'dependency update:');
    expect(hit).toHaveLength(1);
    expect(hit[0].title).toBe('dependency update: ajv (cms)');
    expect(hit[0].severity).toBe('info');
    // the target is the highest stable release, and the finding names where to bump it
    expect(hit[0].detail).toContain('8.22.3');
    expect(hit[0].detail).toContain('package.json');
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

  it('never targets a prerelease, and never proposes a version below the installed one', () => {
    const { findings } = runScanner({
      views: { ...NO_NEWER, vue: ['3.4.0', '3.5.43', '4.0.0-beta.1'], vite: ['7.0.0', '8.3.0', '8.4.0-rc.1'] },
    });
    expect(titled(findings, 'dependency')).toEqual([]);
  });

  it('files no update for a package the registry does not know (E404, a private package)', () => {
    const { status, findings } = runScanner({ views: {} });
    expect(status).toBe(0);
    expect(findings).toEqual([]);
  });

  it('reads direct dependencies from every dependency field of the root package.json', () => {
    const { findings } = runScanner({
      views: { ajv: ['8.20.0'], vite: ['8.3.0', '8.3.9'], vue: ['3.5.43', '3.5.99'] },
    });
    expect(titled(findings, 'dependency update:').map((f) => f.title).sort()).toEqual([
      'dependency update: vite (cms)',
      'dependency update: vue (cms)',
    ]);
  });

  it('uses stable titles: no dates, and identical across two runs of the same tree', () => {
    const opts = {
      audit: report(fastUriVulns()),
      views: { ...NO_NEWER, ajv: ['8.20.0', '8.21.0'], vue: ['3.5.43', '4.0.0'] },
    };
    // The template runs `npm audit` and the `npm view` pool concurrently, so the
    // order findings print in is not stable; dedupe is by title, so the set is
    // what must be.
    const a = runScanner(opts).findings.map((f) => f.title).sort();
    const b = runScanner(opts).findings.map((f) => f.title).sort();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    for (const title of a) {
      expect(title).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      expect(title).not.toMatch(/\b\d+ (advisor|vulnerabilit|finding|package)/i);
    }
  });
});

describe('dependencies scanner — names the repo from git origin', () => {
  it('uses the last path segment of origin, so every title ends with that repo', () => {
    const { findings } = runScanner({
      origin: 'https://github.com/koehler8/site-example.git',
      audit: report(fastUriVulns()),
      views: { ...NO_NEWER, vue: ['3.5.43', '3.5.44'] },
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.title).toMatch(/\(site-example\)$/);
  });

  it('falls back to the package name when there is no origin: @koehler8/cms → cms', () => {
    const { findings } = runScanner({ audit: report(fastUriVulns()) });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.title).toMatch(/\(cms\)$/);
  });

  it('does not speak only for cms: a package with another name is scanned too', () => {
    const pkg = { ...CMS_PACKAGE(), name: 'site-example' };
    const { findings } = runScanner({ pkg, audit: report(fastUriVulns()) });
    expect(mentioning(findings, GHSA_MODERATE).length).toBeGreaterThanOrEqual(1);
  });
});

describe('dependencies scanner — no peer-range finding of any kind', () => {
  it('files nothing about a peer range that excludes the tested version, or admits an older major', () => {
    const pkg = CMS_PACKAGE();
    pkg.peerDependencies = { vite: '^7.0.0', vue: '^3.4.0 || ^2.0.0' };
    const { findings } = runScanner({ pkg });
    expect(findings.filter((f) => /peer/i.test(f.title))).toEqual([]);
    expect(findings).toEqual([]);
  });
});

describe('dependencies scanner — never silently blind', () => {
  const expectBlind = ({ status, findings, stderr }) => {
    expect(status, `scanner must exit 0 even when blind. stderr: ${stderr}`).toBe(0);
    expect(Array.isArray(findings)).toBe(true);
    expect(findings, 'a blind scanner must not print []').not.toEqual([]);
    const blind = blindFindings(findings);
    expect(blind.length).toBeGreaterThanOrEqual(1);
    expect(blind[0].severity).toBe('medium');
    expect(blind[0].detail.length).toBeGreaterThan(0);
    expect(blind[0].title).toMatch(/^dependency scanner blind: .+ \(cms\)$/);
    return blind;
  };

  it('files a "dependency scanner blind" finding when there is no package-lock.json', () => {
    expectBlind(runScanner({ lock: null }));
  });

  it('files a blind finding when package-lock.json does not parse', () => {
    expectBlind(runScanner({ lock: '{ not json' }));
  });

  it('files a blind finding when npm audit prints something unreadable', () => {
    expectBlind(runScanner({ mode: 'garbage' }));
  });

  it('files a blind finding when npm audit returns an error object instead of a report', () => {
    expectBlind(runScanner({ mode: 'error' }));
  });

  it('files a blind finding when the registry cannot be read, instead of assuming nothing is outdated', () => {
    expectBlind(runScanner({ mode: 'viewfail' }));
  });

  it('files a blind finding when the time budget runs out, instead of printing []', () => {
    const run = runScanner({
      mode: 'hang',
      env: { BUILDMILL_DEPENDENCY_SCANNER_BUDGET_MS: '400' },
      timeout: 15000,
    });
    expectBlind(run);
  }, 20000);

  it('gives each blind cause its own stable title, with no counts or dates', () => {
    const a = blindFindings(runScanner({ lock: null }).findings).map((f) => f.title);
    const b = blindFindings(runScanner({ lock: null }).findings).map((f) => f.title);
    expect(a).toEqual(b);
    expect(a.join('\n')).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    const bad = blindFindings(runScanner({ lock: '{ not json' }).findings).map((f) => f.title);
    expect(bad).not.toEqual(a);
  });

  it('does not emit a peer-range blind title: that title belongs to peer-ranges.mjs', () => {
    for (const run of [runScanner({ lock: null }), runScanner({ lock: '{ not json' }), runScanner({ mode: 'garbage' })]) {
      expect(run.findings.filter((f) => /peer-range scanner blind/i.test(f.title))).toEqual([]);
    }
  });
});

describe('dependencies scanner — builder/dependency-holds.json', () => {
  it('silences an advisory whose GHSA id is accepted, but still files the others on that package', () => {
    const { findings } = runScanner({
      audit: report(fastUriVulns()),
      holds: [
        {
          package: 'fast-uri',
          range: '3.x',
          reason: 'no fixed release yet',
          acceptedAdvisories: [GHSA_MODERATE],
        },
      ],
    });
    const combined = findings.filter((f) => f.title.includes('fast-uri')).map(text).join('\n');
    expect(combined).not.toContain(GHSA_MODERATE);
    expect(combined).toContain(GHSA_LOW);
  });

  it('files no update finding for a held package while the installed version is inside the hold range', () => {
    const views = { ...NO_NEWER, vue: ['3.5.43', '3.5.44', '4.0.0'], ajv: ['8.20.0', '8.21.0'] };
    const { findings } = runScanner({
      views,
      holds: [{ package: 'vue', range: '3.x', reason: 'peer-linked to the framework floor' }],
    });
    expect(findings.filter((f) => f.title.includes(' vue '))).toEqual([]);
    expect(findings.filter((f) => f.title.includes(': vue'))).toEqual([]);
    // the hold is per package: ajv still files
    expect(titled(findings, 'dependency update: ajv')).toHaveLength(1);
  });

  it('stops holding once the installed version leaves the hold range', () => {
    const { findings } = runScanner({
      views: { ...NO_NEWER, vue: ['3.5.43', '3.5.44'] },
      holds: [{ package: 'vue', range: '2.x', reason: 'wrong major' }],
    });
    expect(titled(findings, 'dependency update: vue')).toHaveLength(1);
  });

  it('honours no hold that lacks a reason, says so, and still files the finding it tried to silence', () => {
    const { findings } = runScanner({
      audit: report(fastUriVulns()),
      holds: [{ package: 'fast-uri', range: '3.x', acceptedAdvisories: [GHSA_MODERATE] }],
    });
    const combined = findings.filter((f) => f.title.includes('fast-uri')).map(text).join('\n');
    expect(combined).toContain(GHSA_MODERATE);
    const invalid = findings.filter((f) => /^dependency holds invalid: /.test(f.title));
    expect(invalid).toHaveLength(1);
    expect(invalid[0].severity).toBe('medium');
    expect(invalid[0].title).toMatch(/\(cms\)$/);
  });

  it('files "dependency holds invalid" when the holds file does not parse, and silences nothing', () => {
    const { findings } = runScanner({
      holds: '{ not json',
      views: { ...NO_NEWER, vue: ['3.5.43', '3.5.44'] },
    });
    expect(findings.filter((f) => /^dependency holds invalid: /.test(f.title))).toHaveLength(1);
    expect(titled(findings, 'dependency update: vue')).toHaveLength(1);
  });

  it('an empty holds file ([]) is valid and files nothing of its own', () => {
    const { status, findings } = runScanner({ holds: [] });
    expect(status).toBe(0);
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------- policy text
//
// The observer's instructions are the other half of this item: the scanner
// can only report what the brief lets the observer file. These check the
// durable rules, loosely worded on purpose — the prose can be reworked, the
// rules cannot silently flip back.
describe('observer policy text', () => {
  const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ');
  const section = (md, heading) => {
    const start = md.indexOf(heading);
    if (start === -1) return '';
    const rest = md.slice(start + heading.length);
    const next = rest.search(/ ## /);
    return next === -1 ? rest : rest.slice(0, next);
  };
  const between = (md, from, to) => {
    const start = md.indexOf(from);
    if (start === -1) return '';
    const rest = md.slice(start);
    const end = rest.indexOf(to);
    return end === -1 ? rest : rest.slice(0, end);
  };
  const sentences = (md) => md.split(/(?<=[.!?])\s+/);

  const brief = () => read('builder/phases/observe.md');
  const facet = () => read('builder/observe.md');
  const priority4 = () => between(brief(), '4. **Dependency', '5. **Release');
  const source5 = () => {
    const md = facet();
    const start = md.search(/\b5\. \*\*[^*]*dependenc/i);
    if (start === -1) return '';
    const rest = md.slice(start);
    const end = rest.indexOf('## Read-only');
    return end === -1 ? rest : rest.slice(0, end);
  };

  // A sentence that says an outdated package / npm outdated line / bump is
  // "never a finding" without saying whose finding. Scanner-attributed or
  // pass-attributed sentences are the rewritten rule and are allowed.
  const flatOutdatedExclusions = (md) =>
    sentences(md).filter(
      (s) =>
        /outdated|bump/i.test(s) &&
        /\b(never|not)\b/i.test(s) &&
        /finding/i.test(s) &&
        !/scanner|dependency update|major behind|own pass|passes|model/i.test(s),
    );

  it('builder/phases/observe.md no longer lists "dependency findings" as never-file', () => {
    expect(brief()).not.toMatch(/dependency findings\W+[^.]*never file/i);
  });

  it('builder/phases/observe.md says a runtime-tree advisory is a framework defect', () => {
    expect(brief()).toMatch(/advisor[^.]*runtime|runtime[^.]*advisor/i);
  });

  it('builder/phases/observe.md priority 4 attributes advisories to dependencies.mjs and peer gaps to peer-ranges.mjs', () => {
    const p4 = priority4();
    expect(p4.length, 'priority 4 (Dependency defects) not found').toBeGreaterThan(0);
    expect(p4).toContain('builder/scanners/dependencies.mjs');
    expect(p4).toContain('builder/scanners/peer-ranges.mjs');
    expect(p4).toMatch(/peer-ranges\.mjs[^.]*peer|peer[^.]*peer-ranges\.mjs/i);
  });

  it('builder/phases/observe.md priority 4 files a dev-only critical/high advisory as medium, not as silence', () => {
    const p4 = priority4();
    expect(p4).toMatch(/dev-only[^.]*medium|medium[^.]*dev-only/i);
    expect(p4).not.toMatch(/dev tree[^.]*(never ships|not a finding)/i);
  });

  it('builder/phases/observe.md names the scanner\'s own "dependency update:" and "dependency major behind:" findings as standing', () => {
    const md = brief();
    expect(md).toContain('dependency update:');
    expect(md).toContain('dependency major behind:');
  });

  it('builder/phases/observe.md no longer says outdated packages / npm outdated lines are flatly never findings', () => {
    expect(flatOutdatedExclusions(brief())).toEqual([]);
  });

  it('builder/phases/observe.md still says the model\'s own passes never propose a bump', () => {
    const hit = sentences(brief()).filter((s) => /bump/i.test(s) && /\b(never|not)\b/i.test(s));
    expect(hit.length).toBeGreaterThanOrEqual(1);
  });

  it('builder/phases/observe.md keeps the by-design non-findings (regression guard)', () => {
    const md = brief();
    expect(md).toMatch(/consumer sites[^.]*(lagging|older pin)[^.]*/i);
    expect(md).toMatch(/by design/i);
    expect(md).toMatch(/beta\.N/);
    expect(md).toMatch(/lru-cache/);
  });

  it('builder/observe.md source 5 names both scanners and what each reports', () => {
    const s5 = source5();
    expect(s5.length, 'source 5 (the dependency scanners) not found').toBeGreaterThan(0);
    expect(s5).toContain('dependencies.mjs');
    expect(s5).toContain('peer-ranges.mjs');
    // dependencies.mjs: advisories, updates, major-behind; peer-ranges.mjs: the peer findings and its own blind title
    expect(s5).toMatch(/advisor/i);
    expect(s5).toContain('dependency update:');
    expect(s5).toContain('dependency major behind:');
    expect(s5).toMatch(/peer/i);
    expect(s5).toContain('peer-range scanner blind');
    expect(s5).toContain('dependency scanner blind');
  });

  it('builder/observe.md Boundaries count a runtime-tree advisory as a framework defect', () => {
    const boundaries = section(facet(), '## Boundaries');
    expect(boundaries.length).toBeGreaterThan(0);
    expect(boundaries).toMatch(/advisor/i);
  });

  it('builder/observe.md Boundaries no longer say outdated packages or npm outdated lines are flatly not findings', () => {
    const boundaries = section(facet(), '## Boundaries');
    expect(boundaries.length).toBeGreaterThan(0);
    expect(flatOutdatedExclusions(boundaries)).toEqual([]);
    expect(boundaries).toMatch(/dependency update|major behind|scanner/i);
  });

  it('builder/observe.md Coverage block requires the dependency scanner, with a through-timestamp', () => {
    const coverage = section(facet(), '## Coverage block');
    expect(coverage.length).toBeGreaterThan(0);
    expect(coverage).toMatch(/dependenc/i);
    expect(coverage).toMatch(/timestamp/i);
  });

  it('both facets are written in the present tense: no dates', () => {
    for (const md of [facet(), brief()]) {
      expect(md).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    }
  });
});
