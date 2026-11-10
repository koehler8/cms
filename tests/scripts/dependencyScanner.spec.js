import { describe, it, expect, afterEach, vi } from 'vitest';
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
import { fileURLToPath, pathToFileURL } from 'node:url';

// builder/scanners/dependencies.mjs — the cms observer's dependency scanner.
//
// Most of this spec drives the scanner the way the buildmill runner does: as a
// subprocess whose cwd is the repo clone, reading a JSON array of
// { title, detail, severity } from stdout. `npm` is replaced by a stub on PATH
// that answers `npm audit` with canned reports, so nothing here touches the
// network and nothing depends on today's lockfile or today's advisories.
//
// The pure-function block at the bottom imports the module directly. It relies
// on two named exports, advisoryFindings and peerGapFindings — see the notes
// on that block.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCANNER = path.join(ROOT, 'builder/scanners/dependencies.mjs');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// ---------------------------------------------------------------- npm stub

// Mimics the parts of npm the scanner might call:
//   npm audit      canned report (runtime-only when --omit=dev is passed,
//                  otherwise the full report); exit 1 when it lists vulns,
//                  like the real thing
//   npm outdated   a "newer versions exist" report, exit 1 like the real thing
//   npm view       a version list that always has a newer release
// STUB_NPM_MODE: ok | garbage | error | hang
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
    const omitDev = args.includes('--omit=dev') || (args.includes('--omit') && args[args.indexOf('--omit') + 1] === 'dev');
    const file = path.join(dir, omitDev ? 'audit-runtime.json' : 'audit-full.json');
    const text = fs.readFileSync(file, 'utf8');
    process.stdout.write(text);
    const report = JSON.parse(text);
    process.exit(Object.keys(report.vulnerabilities || {}).length ? 1 : 0);
  }
} else if (sub === 'outdated') {
  process.stdout.write(JSON.stringify({
    vue: { current: '3.5.43', wanted: '3.5.43', latest: '9.9.9' },
    'fast-uri': { current: '3.1.8', wanted: '3.1.9', latest: '3.1.9' },
  }));
  process.exit(1);
} else if (sub === 'view') {
  process.stdout.write(JSON.stringify(['1.0.0', '3.5.43', '9.9.9']));
  process.exit(0);
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

// The shape of today's real finding: fast-uri reached through ajv, with the
// inheriting `ajv` entry whose `via` is just the string "fast-uri".
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
    'node_modules/vite': lockEntry('8.3.0', { dev: true, peer: true }),
    'node_modules/vue': lockEntry('3.5.43', { dev: true, peer: true }),
  },
});

const tmpDirs = [];

function makeDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

// Run the scanner in a throwaway "clone". Returns { status, findings, stdout,
// stderr }. `findings` is the parsed stdout (undefined if it was not JSON).
function runScanner({
  pkg = CMS_PACKAGE(),
  lock = CMS_LOCK(pkg),
  full = CLEAN_REPORT,
  runtime = full,
  holds,
  mode = 'ok',
  env = {},
  timeout = 20000,
} = {}) {
  const repo = makeDir('cms-depscan-repo-');
  const bin = makeDir('cms-depscan-bin-');
  if (pkg !== null) writeFileSync(path.join(repo, 'package.json'), JSON.stringify(pkg, null, 2));
  if (lock !== null) writeFileSync(path.join(repo, 'package-lock.json'), JSON.stringify(lock, null, 2));
  if (holds !== undefined) {
    mkdirSync(path.join(repo, 'builder'), { recursive: true });
    writeFileSync(
      path.join(repo, 'builder/dependency-holds.json'),
      typeof holds === 'string' ? holds : JSON.stringify(holds),
    );
  }
  writeFileSync(path.join(bin, 'npm'), NPM_STUB);
  chmodSync(path.join(bin, 'npm'), 0o755);
  writeFileSync(path.join(bin, 'audit-full.json'), JSON.stringify(full));
  writeFileSync(path.join(bin, 'audit-runtime.json'), JSON.stringify(runtime));

  const res = spawnSync(process.execPath, [SCANNER], {
    cwd: repo,
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

const text = (f) => `${f.title}\n${f.detail}`;
const mentioning = (findings, needle) => findings.filter((f) => text(f).includes(needle));
const blindFindings = (findings) => findings.filter((f) => /dependency scanner blind/i.test(f.title));

// ------------------------------------------------------------------- the run

describe('dependencies scanner — runtime-tree advisories', () => {
  it('exists where the runner looks for it', () => {
    expect(existsSync(SCANNER)).toBe(true);
  });

  it('reports a runtime advisory (fast-uri via ajv) with its advisory ids, and exits 0', () => {
    const vulnerabilities = fastUriVulns();
    const { status, findings, stderr } = runScanner({ full: report(vulnerabilities) });

    expect(status).toBe(0);
    expect(Array.isArray(findings), `stdout was not a JSON array. stderr: ${stderr}`).toBe(true);

    const fastUri = findings.filter((f) => f.title.includes('fast-uri'));
    expect(fastUri.length).toBeGreaterThanOrEqual(1);
    // both advisory ids are visible somewhere in the fast-uri findings
    const combined = fastUri.map(text).join('\n');
    expect(combined).toContain(GHSA_MODERATE);
    expect(combined).toContain(GHSA_LOW);
    // the installed version is named so the reader can tell what to bump
    expect(combined).toContain('3.1.8');
  });

  it('keeps the {title, detail, severity} contract on every finding', () => {
    const { findings } = runScanner({ full: report(fastUriVulns()) });
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
    const { findings } = runScanner({ full: report(fastUriVulns()) });
    // ajv is only affected through fast-uri; the finding belongs to fast-uri
    expect(findings.filter((f) => f.title.includes('ajv'))).toEqual([]);
  });

  it('maps advisory level to severity: high → high, moderate → low, low → info', () => {
    const vulnerabilities = {
      'rt-high': vuln(
        'rt-high',
        'high',
        [advisory(10, 'rt-high', GHSA_HIGH, 'high', '<2.0.1', 'rt-high bad')],
        ['node_modules/rt-high'],
      ),
      'rt-mod': vuln(
        'rt-mod',
        'moderate',
        [advisory(11, 'rt-mod', GHSA_MOD2, 'moderate', '<1.0.1', 'rt-mod bad')],
        ['node_modules/rt-mod'],
      ),
      'rt-low': vuln(
        'rt-low',
        'low',
        [advisory(12, 'rt-low', GHSA_LOW2, 'low', '<1.0.1', 'rt-low bad')],
        ['node_modules/rt-low'],
      ),
    };
    const { findings } = runScanner({ full: report(vulnerabilities) });

    const sev = (needle) => {
      const hit = mentioning(findings, needle);
      expect(hit.length, `no finding mentions ${needle}`).toBeGreaterThanOrEqual(1);
      return hit[0].severity;
    };
    expect(sev('rt-high')).toBe('high');
    expect(sev('rt-mod')).toBe('low');
    expect(sev('rt-low')).toBe('info');
  });

  it('uses stable titles: no dates, and identical across two runs of the same tree', () => {
    const opts = { full: report(fastUriVulns()) };
    const a = runScanner(opts).findings.map((f) => f.title);
    const b = runScanner(opts).findings.map((f) => f.title);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    for (const title of a) {
      expect(title).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      expect(title).not.toMatch(/\b\d+ (advisor|vulnerabilit|finding|package)/i);
    }
  });

  it('prints [] and exits 0 for a tree with no advisories and satisfied peer ranges', () => {
    const { status, findings, stdout } = runScanner();
    expect(status).toBe(0);
    expect(findings).toEqual([]);
    expect(stdout.trim()).toBe('[]');
  });
});

describe('dependencies scanner — what must NOT become a finding', () => {
  // The runtime-only report is what `npm audit --omit=dev` returns; the full
  // report is what a plain `npm audit` returns. The scanner may use either
  // strategy (omit-dev, or split by the lockfile's dev flags) — both must
  // leave dev-only advisories out.
  const devOnlyVuln = {
    'dev-only': vuln(
      'dev-only',
      'high',
      [advisory(20, 'dev-only', GHSA_DEV, 'high', '<4.0.1', 'dev-only bad')],
      ['node_modules/dev-only'],
    ),
  };

  it('files nothing for an advisory that exists only in the dev tree', () => {
    const { findings } = runScanner({ full: report(devOnlyVuln), runtime: CLEAN_REPORT });
    expect(findings).toEqual([]);
  });

  it('still files the runtime advisory when a dev-only one sits beside it', () => {
    const { findings } = runScanner({
      full: report({ ...fastUriVulns(), ...devOnlyVuln }),
      runtime: report(fastUriVulns()),
    });
    expect(mentioning(findings, 'fast-uri').length).toBeGreaterThanOrEqual(1);
    expect(mentioning(findings, 'dev-only')).toEqual([]);
    expect(mentioning(findings, GHSA_DEV)).toEqual([]);
  });

  it('files nothing for outdated packages, even when the registry offers newer releases', () => {
    // The stub answers `npm outdated` and `npm view` with newer versions of
    // vue and fast-uri. A clean audit must still produce a clean sweep.
    const { status, findings } = runScanner();
    expect(status).toBe(0);
    expect(findings).toEqual([]);
  });
});

describe('dependencies scanner — peer-dependency gap', () => {
  const withPeers = ({ peers, dev, locked }) => {
    const pkg = {
      name: '@koehler8/cms',
      version: '1.4.2',
      dependencies: {},
      devDependencies: dev,
      peerDependencies: peers,
    };
    const lock = CMS_LOCK(pkg);
    for (const key of Object.keys(lock.packages)) {
      if (key !== '' && !key.endsWith('/ajv') && !key.endsWith('/fast-uri')) delete lock.packages[key];
    }
    for (const [name, version] of Object.entries(locked)) {
      lock.packages[`node_modules/${name}`] = lockEntry(version, { dev: true, peer: true });
    }
    return { pkg, lock };
  };

  it('files nothing for minor/patch floor spread (vite ^8.0.0 vs 8.3.0, vue ^3.5.0 vs 3.5.43)', () => {
    const { findings } = runScanner(
      withPeers({
        peers: { vite: '^8.0.0', vue: '^3.5.0' },
        dev: { vite: '^8.3.0', vue: '^3.5.43' },
        locked: { vite: '8.3.0', vue: '3.5.43' },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('files a finding when the installed dev version does not satisfy the peer range', () => {
    const { findings } = runScanner(
      withPeers({
        peers: { vite: '^8.0.0', vue: '^3.5.0' },
        dev: { vite: '^8.3.0', vue: '^3.4.0' },
        locked: { vite: '8.3.0', vue: '3.4.9' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('vue');
    expect(text(findings[0])).toContain('3.4.9');
    expect(SEVERITIES).toContain(findings[0].severity);
  });

  it("files a finding when the peer range's lowest major is below the installed dev major", () => {
    const { findings } = runScanner(
      withPeers({
        peers: { vite: '^7.0.0 || ^8.0.0', vue: '^3.5.0' },
        dev: { vite: '^8.3.0', vue: '^3.5.43' },
        locked: { vite: '8.3.0', vue: '3.5.43' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('vite');
    expect(text(findings[0])).toMatch(/7/);
    expect(text(findings[0])).toContain('8.3.0');
  });

  it('treats an open-ended floor (>=7) under an 8.x dev install as an older-major gap too', () => {
    const { findings } = runScanner(
      withPeers({
        peers: { vite: '>=7.0.0' },
        dev: { vite: '^8.3.0' },
        locked: { vite: '8.3.0' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('vite');
  });

  it('ignores a peer dependency that has no matching devDependency to compare against', () => {
    const { findings } = runScanner(
      withPeers({
        peers: { 'some-peer': '^1.0.0', vue: '^3.5.0' },
        dev: { vue: '^3.5.43' },
        locked: { vue: '3.5.43' },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('files nothing when package.json declares no peerDependencies', () => {
    const { pkg, lock } = withPeers({ peers: {}, dev: { vue: '^3.5.43' }, locked: { vue: '3.5.43' } });
    delete pkg.peerDependencies;
    const { status, findings } = runScanner({ pkg, lock });
    expect(status).toBe(0);
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
  });
});

describe('dependencies scanner — only speaks for @koehler8/cms', () => {
  it('stays silent ([]) in a clone whose package.json is not @koehler8/cms, even with advisories present', () => {
    const pkg = { ...CMS_PACKAGE(), name: 'site-example' };
    const { status, findings } = runScanner({ pkg, full: report(fastUriVulns()) });
    expect(status).toBe(0);
    expect(findings).toEqual([]);
  });

  it('stays silent in a non-cms clone with no lockfile (silent, not blind)', () => {
    const pkg = { ...CMS_PACKAGE(), name: 'site-example' };
    const { status, findings } = runScanner({ pkg, lock: null });
    expect(status).toBe(0);
    expect(findings).toEqual([]);
  });
});

describe('dependencies scanner — builder/dependency-holds.json', () => {
  it('silences an advisory whose GHSA id is accepted, but still files the others on that package', () => {
    const { findings } = runScanner({
      full: report(fastUriVulns()),
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

  it('honours no hold that lacks a reason, and says so', () => {
    const { findings } = runScanner({
      full: report(fastUriVulns()),
      holds: [{ package: 'fast-uri', range: '3.x', acceptedAdvisories: [GHSA_MODERATE] }],
    });
    const combined = findings.filter((f) => f.title.includes('fast-uri')).map(text).join('\n');
    expect(combined).toContain(GHSA_MODERATE);
    expect(findings.some((f) => /hold/i.test(f.title) && /invalid/i.test(f.title))).toBe(true);
  });
});

// ----------------------------------------------------------- pure functions
//
// Seam this block depends on (named in the test-writer summary for the plan):
// builder/scanners/dependencies.mjs exports, behind a main-module guard so that
// importing it neither scans nor writes to stdout,
//
//   advisoryFindings(auditReport, lockPackages, holds, repoName) → finding[]
//       npm audit --json (v2) report + the lockfile's `packages` map; `holds`
//       is the parsed holds list ([] for none). Runtime-tree advisories only.
//   peerGapFindings(packageJson, lockPackages, repoName) → finding[]
//
// Both return arrays of { title, detail, severity }.
describe('dependencies scanner — pure functions', () => {
  async function load() {
    const writes = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(SCANNER).href);
      return { mod, writes: writes.mock.calls.length };
    } finally {
      writes.mockRestore();
    }
  }

  it('can be imported without running a scan (main-module guard)', async () => {
    const { writes } = await load();
    expect(writes).toBe(0);
  });

  it('exports the advisory classifier and the peer-gap check', async () => {
    const { mod } = await load();
    expect(typeof mod.advisoryFindings).toBe('function');
    expect(typeof mod.peerGapFindings).toBe('function');
  });

  it('advisoryFindings: classifies runtime advisories and drops dev-only ones by the lockfile flags', async () => {
    const { mod } = await load();
    const lockPackages = CMS_LOCK().packages;
    const found = mod.advisoryFindings(
      report({
        ...fastUriVulns(),
        'dev-only': vuln(
          'dev-only',
          'high',
          [advisory(20, 'dev-only', GHSA_DEV, 'high', '<4.0.1', 'dev-only bad')],
          ['node_modules/dev-only'],
        ),
      }),
      lockPackages,
      [],
      'cms',
    );
    const combined = found.map(text).join('\n');
    expect(combined).toContain(GHSA_MODERATE);
    expect(combined).toContain(GHSA_LOW);
    expect(combined).not.toContain(GHSA_DEV);
    expect(found.find((f) => text(f).includes(GHSA_MODERATE)).severity).toBe('low');
    expect(found.find((f) => text(f).includes(GHSA_LOW)).severity).toBe('info');
  });

  it('advisoryFindings: a clean report is []', async () => {
    const { mod } = await load();
    expect(mod.advisoryFindings(CLEAN_REPORT, CMS_LOCK().packages, [], 'cms')).toEqual([]);
  });

  it('peerGapFindings: unsatisfied → finding, older peer-floor major → finding, minor spread → none', async () => {
    const { mod } = await load();
    const lock = {
      'node_modules/vite': lockEntry('8.3.0', { dev: true }),
      'node_modules/vue': lockEntry('3.4.9', { dev: true }),
      'node_modules/vue-router': lockEntry('5.3.1', { dev: true }),
    };
    const pkg = {
      name: '@koehler8/cms',
      devDependencies: { vite: '^8.3.0', vue: '^3.4.0', 'vue-router': '^5.3.0' },
      peerDependencies: { vite: '^7.0.0 || ^8.0.0', vue: '^3.5.0', 'vue-router': '^5.0.0' },
    };
    const found = mod.peerGapFindings(pkg, lock, 'cms');
    expect(found.filter((f) => f.title.includes('vite'))).toHaveLength(1);
    expect(found.filter((f) => f.title.includes('vue') && !f.title.includes('vue-router'))).toHaveLength(1);
    expect(found.filter((f) => f.title.includes('vue-router'))).toEqual([]);
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

  const brief = () => read('builder/phases/observe.md');
  const facet = () => read('builder/observe.md');

  it('builder/phases/observe.md no longer lists "dependency findings" as never-file', () => {
    expect(brief()).not.toMatch(/dependency findings\W+[^.]*never file/i);
  });

  it('builder/phases/observe.md says a runtime-tree advisory is a framework defect', () => {
    expect(brief()).toMatch(/advisor[^.]*runtime|runtime[^.]*advisor/i);
  });

  it('builder/phases/observe.md names peer-range gaps as framework defects too', () => {
    expect(brief()).toMatch(/peer/i);
  });

  it('builder/phases/observe.md still says outdated packages / npm outdated / bump proposals are not findings', () => {
    expect(brief()).toMatch(/npm outdated/i);
    expect(brief()).toMatch(/outdated[^.]*(never|not)[^.]*(finding|defect)|(never|not)[^.]*(finding|defect)[^.]*outdated/i);
  });

  it('builder/phases/observe.md keeps the by-design non-findings (regression guard)', () => {
    const md = brief();
    expect(md).toMatch(/consumer sites[^.]*(lagging|older pin)[^.]*/i);
    expect(md).toMatch(/by design/i);
    expect(md).toMatch(/beta\.N/);
    expect(md).toMatch(/lru-cache/);
  });

  it('builder/observe.md names the dependency scanner as a source', () => {
    expect(facet()).toMatch(/dependencies\.mjs|dependency scanner/i);
  });

  it('builder/observe.md Boundaries count a runtime-tree advisory as a framework defect', () => {
    const boundaries = section(facet(), '## Boundaries');
    expect(boundaries.length).toBeGreaterThan(0);
    expect(boundaries).toMatch(/advisor/i);
  });

  it('builder/observe.md Coverage block requires the dependency scanner, with a through-timestamp', () => {
    const coverage = section(facet(), '## Coverage block');
    expect(coverage.length).toBeGreaterThan(0);
    expect(coverage).toMatch(/dependenc/i);
    expect(coverage).toMatch(/timestamp/i);
  });
});
