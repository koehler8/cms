import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// builder/scanners/peer-ranges.mjs — the cms-only peer-range check, split out of
// the standard dependency scanner. Per peerDependencies entry that is also a
// devDependency: range excludes the tested version → medium; admits a lower
// untested major → low; unreadable → low; minor/patch spread → nothing.
// Driven as a subprocess (cwd = the clone); reads package.json and the lockfile only.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PEER_SCANNER = path.join(ROOT, 'builder/scanners/peer-ranges.mjs');
const DEP_SCANNER = path.join(ROOT, 'builder/scanners/dependencies.mjs');

const PEER_TITLE = /^dependency peer (gap: .+ (range excludes the tested version|admits untested \d+\.x)|range unreadable: .+) \(cms\)$/;
const PEER_BLIND = /^peer-range scanner blind: .+ \(cms\)$/;
const EXCLUDES = 'dependency peer gap: vue range excludes the tested version (cms)';

const lockEntry = (version, extra = {}) => ({
  version,
  resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
  integrity: 'sha512-x',
  ...extra,
});

// A clone whose peer contract is `peers`, devDependencies `dev`, and whose
// lockfile resolves each name in `locked` to the version given.
function fixture({ peers, dev, locked, name = '@koehler8/cms' }) {
  const pkg = { name, version: '1.4.2', dependencies: {}, devDependencies: dev, peerDependencies: peers };
  const lock = {
    name,
    version: pkg.version,
    lockfileVersion: 3,
    packages: { '': { name, version: pkg.version, devDependencies: dev, peerDependencies: peers } },
  };
  for (const [dep, version] of Object.entries(locked)) {
    lock.packages[`node_modules/${dep}`] = lockEntry(version, { dev: true, peer: true });
  }
  return { pkg, lock };
}

// One peer pair against vue 3.5.43 (the tested version in most cases below).
const vue = (range, extra = {}) =>
  fixture({ peers: { vue: range }, dev: { vue: '^3.5.43' }, locked: { vue: '3.5.43' }, ...extra });

const HEALTHY = () =>
  fixture({
    peers: { vite: '^8.0.0', vue: '^3.5.0' },
    dev: { vite: '^8.3.0', vue: '^3.5.43' },
    locked: { vite: '8.3.0', vue: '3.5.43' },
  });

// peer gaps of every kind: vite admits 7.x, vue excludes 3.4.9, pinia is a hyphen range
const GAPPY = () =>
  fixture({
    peers: { vite: '^7.0.0 || ^8.0.0', vue: '^3.5.0', pinia: '1.0.0 - 2.0.0' },
    dev: { vite: '^8.3.0', vue: '^3.4.0', pinia: '^2.1.0' },
    locked: { vite: '8.3.0', vue: '3.4.9', pinia: '2.1.0' },
  });

const tmpDirs = [];
const makeDir = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

const parse = (res) => {
  let findings;
  try {
    findings = JSON.parse(res.stdout);
  } catch {
    findings = undefined;
  }
  return { status: res.status, findings, stdout: res.stdout, stderr: res.stderr };
};

// Run a scanner file in a throwaway clone; a null pkg/lock is left absent.
function runIn(scanner, { pkg, lock, env = {} }) {
  const repo = makeDir('cms-peer-repo-');
  const put = (file, v) =>
    v !== null && writeFileSync(path.join(repo, file), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  put('package.json', pkg);
  put('package-lock.json', lock);
  return parse(
    spawnSync(process.execPath, [scanner], { cwd: repo, encoding: 'utf8', timeout: 20000, env: { ...process.env, ...env } }),
  );
}
const runPeer = (opts) => runIn(PEER_SCANNER, opts);
const titles = (opts) => runPeer(opts).findings.map((f) => f.title);

// ------------------------------------------------------------- the peer check

describe('peer-ranges scanner — on this repo', () => {
  it('prints a JSON array of peer findings only, and exits 0', () => {
    const res = parse(spawnSync(process.execPath, [PEER_SCANNER], { cwd: ROOT, encoding: 'utf8', timeout: 20000 }));
    expect(res.status).toBe(0);
    expect(Array.isArray(res.findings), `stdout was not a JSON array. stderr: ${res.stderr}`).toBe(true);
    for (const f of res.findings) expect(f.title).toMatch(PEER_TITLE);
  });
});

describe('peer-ranges scanner — peer-dependency gap', () => {
  it('files nothing for minor/patch floor spread (vite ^8.0.0 vs 8.3.0, vue ^3.5.0 vs 3.5.43), and prints []', () => {
    const { status, findings, stdout } = runPeer(HEALTHY());
    expect(status).toBe(0);
    expect(findings).toEqual([]);
    expect(stdout.trim()).toBe('[]');
  });

  it('files a medium finding when the peer range excludes the tested version', () => {
    const { findings } = runPeer(
      fixture({ peers: { vue: '^3.5.0' }, dev: { vue: '^3.4.0' }, locked: { vue: '3.4.9' } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe(EXCLUDES);
    expect(findings[0].severity).toBe('medium');
    expect(`${findings[0].title}\n${findings[0].detail}`).toContain('3.4.9');
    expect(findings[0].proposedChange.length).toBeGreaterThan(0);
  });

  it("files a low finding when the peer range's lowest major is below the tested major (^7 || ^8, and open-ended >=7)", () => {
    for (const range of ['^7.0.0 || ^8.0.0', '>=7.0.0']) {
      const { findings } = runPeer(fixture({ peers: { vite: range }, dev: { vite: '^8.3.0' }, locked: { vite: '8.3.0' } }));
      expect(findings, range).toHaveLength(1);
      expect(findings[0].title).toBe('dependency peer gap: vite admits untested 7.x (cms)');
      expect(findings[0].severity).toBe('low');
      expect(findings[0].detail).toContain('8.3.0');
    }
  });

  it('files a low "unreadable" finding for ranges the reader refuses to guess at (hyphen, x wildcard, prerelease)', () => {
    for (const range of ['7.0.0 - 8.9.9', '3.x', '^3.5.0-beta.1']) {
      const { findings } = runPeer(vue(range));
      expect(findings.map((f) => f.title), range).toEqual(['dependency peer range unreadable: vue (cms)']);
      expect(findings[0].severity).toBe('low');
    }
  });

  it('reads ^ ~ >= > <= < = comparators, spaces and ||', () => {
    for (const range of ['^3.5.0', '~3.5.0', '>=3.5.0', '>3.5.0 <4', '<=3.5.43', '3.5.43', '>= 3.5.0', '^2.0.0 || ^3.5.0']) {
      expect(titles(vue(range)), `${range} admits 3.5.43`).not.toContain(EXCLUDES);
    }
    for (const range of ['^3.6.0', '~3.4.0', '>3.5.43', '<3.5.43', '4.0.0', '>=4 || <3']) {
      expect(titles(vue(range)), `${range} excludes 3.5.43`).toContain(EXCLUDES);
    }
  });

  it('ignores a peer with no matching devDependency, and a package with no peerDependencies', () => {
    const noDev = fixture({ peers: { 'some-peer': '^1.0.0', vue: '^3.5.0' }, dev: { vue: '^3.5.43' }, locked: { vue: '3.5.43' } });
    expect(runPeer(noDev).findings).toEqual([]);
    const { pkg, lock } = vue('^3.5.0');
    delete pkg.peerDependencies;
    expect(runPeer({ pkg, lock }).findings).toEqual([]);
  });

  it('stays silent in a clone whose package.json is not @koehler8/cms, with or without a lockfile', () => {
    const gap = fixture({ name: 'site-example', peers: { vue: '^3.5.0' }, dev: { vue: '^3.4.0' }, locked: { vue: '3.4.9' } });
    expect(runPeer(gap).findings).toEqual([]);
    expect(runPeer({ pkg: gap.pkg, lock: null })).toMatchObject({ status: 0, findings: [] });
  });
});

// ------------------------------------------------------------ never silently blind

describe('peer-ranges scanner — never silently blind', () => {
  const blindOf = (opts) => {
    const { status, findings, stderr } = runPeer(opts);
    expect(status, `scanner must exit 0 even when blind. stderr: ${stderr}`).toBe(0);
    expect(findings, 'a blind scanner must not print []').not.toEqual([]);
    const blind = findings.filter((f) => /peer-range scanner blind/i.test(f.title));
    expect(blind).toHaveLength(1);
    expect(blind[0].title).toMatch(PEER_BLIND);
    expect(blind[0].severity).toBe('medium');
    expect(blind[0].detail.length).toBeGreaterThan(0);
    // the standard scanner owns these titles; this one never files them
    expect(findings.filter((f) => /dependency scanner blind|dependency holds invalid/i.test(f.title))).toEqual([]);
    return blind[0].title;
  };

  it('files a medium "peer-range scanner blind" finding when an input is missing or unreadable', () => {
    const { pkg, lock } = HEALTHY();
    const noLock = blindOf({ pkg, lock: null });
    const badLock = blindOf({ pkg, lock: '{ not json' });
    const noPkg = blindOf({ pkg: null, lock });
    blindOf({ pkg, lock: { lockfileVersion: 1, dependencies: {} } }); // no "packages" map
    blindOf({ pkg: '{ not json', lock });
    // each of the three main causes has its own stable title, with no counts or dates
    expect(new Set([noLock, badLock, noPkg]).size).toBe(3);
    expect(noLock).toBe(blindOf({ pkg, lock: null }));
    expect(noLock).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });
});

// ----------------------------------------------------------- negative control

describe('peer-ranges scanner — its own negative control', () => {
  // The classifier is run through a built-in fixture on every scan; when its
  // verdicts disagree the scanner says so rather than print what a broken
  // classifier computed. Break the classifier in a throwaway copy and the copy
  // must report itself blind; the unbroken copy is the reference.
  const copyScanner = (mutate) => {
    const file = path.join(makeDir('cms-peer-copy-'), 'peer-ranges.mjs');
    copyFileSync(PEER_SCANNER, file);
    if (mutate) writeFileSync(file, mutate(readFileSync(file, 'utf8')));
    return file;
  };
  const broken = (pattern, replacement) => {
    let changed = 0;
    const file = copyScanner((src) => src.replace(pattern, () => (changed++, replacement)));
    expect(changed, `no ${pattern} found in peer-ranges.mjs to break`).toBeGreaterThan(0);
    return runIn(file, HEALTHY());
  };

  it('files a medium blind finding naming the control when low becomes info; the unbroken copy is silent', () => {
    const ref = runIn(copyScanner(), HEALTHY());
    expect(ref.status, ref.stderr).toBe(0);
    expect(ref.findings).toEqual([]);
    const { findings } = broken(/severity:\s*(["'])low\1/g, 'severity: "info"');
    const blind = findings.filter((f) => PEER_BLIND.test(f.title));
    expect(blind, JSON.stringify(findings)).toHaveLength(1);
    expect(blind[0].severity).toBe('medium');
    expect(blind[0].title).toMatch(/control/i);
    // inverting the older-major test breaks it too
    const inverted = broken(/\[0\]\s*<\s*v\.major/g, '[0] > v.major');
    expect(inverted.findings.filter((f) => PEER_BLIND.test(f.title))).toHaveLength(1);
  });

});

// ----------------------------------------- no finding title shared with dependencies.mjs

describe('peer-ranges scanner and dependencies scanner — no shared finding title', () => {
  // dependencies.mjs needs npm for `audit` and `view`: a clean audit, and a
  // registry with newer releases of vue and vite, so it has findings of its own.
  const NPM_STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (v, code = 0) => { process.stdout.write(JSON.stringify(v)); process.exit(code); };
if (args[0] === 'audit') out({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} });
const name = args[args.indexOf('--') + 1];
const versions = { vue: ['3.4.9', '3.5.99', '4.0.0'], vite: ['8.3.0', '8.9.0'] };
if (args[0] === 'view' && versions[name]) out(versions[name]);
out({ error: { code: 'E404', summary: 'not found' } }, 1);
`;
  const bothRun = (opts) => {
    const bin = makeDir('cms-peer-bin-');
    writeFileSync(path.join(bin, 'npm'), NPM_STUB);
    chmodSync(path.join(bin, 'npm'), 0o755);
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    return { peer: runIn(PEER_SCANNER, { ...opts, env }).findings, dep: runIn(DEP_SCANNER, { ...opts, env }).findings };
  };

  const scenarios = {
    'peer gaps and newer releases': GAPPY,
    'no lockfile': () => ({ pkg: HEALTHY().pkg, lock: null }),
  };
  for (const [label, make] of Object.entries(scenarios)) {
    it(`emits disjoint titles, each scanner in its own namespace, on ${label}`, () => {
      const { peer, dep } = bothRun(make());
      expect(peer.length + dep.length).toBeGreaterThan(0);
      expect(peer.filter((f) => dep.some((g) => g.title === f.title))).toEqual([]);
      for (const f of peer) expect(f.title).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      for (const f of peer) expect(f.title).toMatch(/^(dependency peer |peer-range scanner blind: )/);
      for (const f of dep) expect(f.title).not.toMatch(/^dependency peer |peer-range scanner blind/);
    });
  }
});

// ----------------------------------------------------------- pure functions

describe('peer-ranges scanner — pure functions', () => {
  async function load() {
    const writes = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(PEER_SCANNER).href);
      return { mod, writes: writes.mock.calls.length };
    } finally {
      writes.mockRestore();
    }
  }

  it('can be imported without running a scan, and exports peerGapFindings', async () => {
    const { mod, writes } = await load();
    expect(writes).toBe(0);
    expect(typeof mod.peerGapFindings).toBe('function');
    expect(mod.peerGapFindings({ name: '@koehler8/cms', devDependencies: { vue: '^3.5.43' } }, {}, 'cms')).toEqual([]);
  });
});
