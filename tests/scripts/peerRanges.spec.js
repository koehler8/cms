import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// builder/scanners/peer-ranges.mjs — the cms-only peer-range check, split out
// of the dependency scanner so that builder/scanners/dependencies.mjs can be
// buildmill's standard scanner, byte for byte.
//
// It reports, for each peerDependencies entry that is also a devDependency,
// how the peer range relates to the version the lockfile resolves (the version
// cms is developed and tested against):
//
//   the range does not admit the tested version        medium
//   the range admits a major below the tested major    low
//   the range or the version cannot be read            low
//
// Minor and patch spread under the floor is not a gap.
//
// Like the dependency scanner it is driven as a subprocess whose cwd is the
// clone, reading a JSON array of { title, detail, severity, proposedChange }
// from stdout. It reads package.json and package-lock.json only, so no npm
// stub is needed: nothing here touches the network.
//
// The pure-function block imports the module directly. It relies on one named
// export, peerGapFindings, behind a main-module guard so that importing it
// neither scans nor writes to stdout.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PEER_SCANNER = path.join(ROOT, 'builder/scanners/peer-ranges.mjs');
const DEP_SCANNER = path.join(ROOT, 'builder/scanners/dependencies.mjs');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

const PEER_TITLE = /^dependency peer (gap: .+ (range excludes the tested version|admits untested \d+\.x)|range unreadable: .+) \(cms\)$/;
const PEER_BLIND = /^peer-range scanner blind: .+ \(cms\)$/;

// --------------------------------------------------------------- repo fixture

const lockEntry = (version, extra = {}) => ({
  version,
  resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
  integrity: 'sha512-x',
  ...extra,
});

// A clone whose peer contract is `peers`, whose devDependencies are `dev`, and
// whose lockfile resolves each name in `locked` to the version given.
function fixture({ peers, dev, locked, name = '@koehler8/cms' }) {
  const pkg = {
    name,
    version: '1.4.2',
    dependencies: {},
    devDependencies: dev,
    peerDependencies: peers,
  };
  const lock = {
    name,
    version: pkg.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name, version: pkg.version, devDependencies: dev, peerDependencies: peers },
    },
  };
  for (const [dep, version] of Object.entries(locked)) {
    lock.packages[`node_modules/${dep}`] = lockEntry(version, { dev: true, peer: true });
  }
  return { pkg, lock };
}

const HEALTHY = () =>
  fixture({
    peers: { vite: '^8.0.0', vue: '^3.5.0' },
    dev: { vite: '^8.3.0', vue: '^3.5.43' },
    locked: { vite: '8.3.0', vue: '3.5.43' },
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

function writeClone(repo, { pkg, lock }) {
  if (pkg !== null) {
    writeFileSync(path.join(repo, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg, null, 2));
  }
  if (lock !== null) {
    writeFileSync(path.join(repo, 'package-lock.json'), typeof lock === 'string' ? lock : JSON.stringify(lock, null, 2));
  }
}

function parse(res) {
  let findings;
  try {
    findings = JSON.parse(res.stdout);
  } catch {
    findings = undefined;
  }
  return { status: res.status, findings, stdout: res.stdout, stderr: res.stderr };
}

// Run a scanner file in a throwaway clone.
function runIn(scanner, { pkg, lock, env = {} }) {
  const repo = makeDir('cms-peer-repo-');
  writeClone(repo, { pkg, lock });
  return parse(
    spawnSync(process.execPath, [scanner], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, ...env },
    }),
  );
}

const runPeer = (opts) => runIn(PEER_SCANNER, opts);

const text = (f) => `${f.title}\n${f.detail}`;

// -------------------------------------------------------------------- the file

describe('peer-ranges scanner — where the runner looks for it', () => {
  it('exists beside the dependency scanner', () => {
    expect(existsSync(PEER_SCANNER)).toBe(true);
    expect(existsSync(DEP_SCANNER)).toBe(true);
  });
});

// ------------------------------------------------------------ on this repo

describe('peer-ranges scanner — on this repo', () => {
  it('prints a JSON array of peer findings only, exits 0, and is not blind', () => {
    const res = parse(spawnSync(process.execPath, [PEER_SCANNER], { cwd: ROOT, encoding: 'utf8', timeout: 20000 }));
    expect(res.status).toBe(0);
    expect(Array.isArray(res.findings), `stdout was not a JSON array. stderr: ${res.stderr}`).toBe(true);
    for (const f of res.findings) {
      expect(f.title, 'only the three peer titles may appear on a healthy tree').toMatch(PEER_TITLE);
      expect(SEVERITIES).toContain(f.severity);
    }
  });
});

// ----------------------------------------------------------- the peer check

describe('peer-ranges scanner — peer-dependency gap', () => {
  it('files nothing for minor/patch floor spread (vite ^8.0.0 vs 8.3.0, vue ^3.5.0 vs 3.5.43), and prints []', () => {
    const { status, findings, stdout } = runPeer(HEALTHY());
    expect(status).toBe(0);
    expect(findings).toEqual([]);
    expect(stdout.trim()).toBe('[]');
  });

  it('files a medium finding when the peer range excludes the tested version', () => {
    const { status, findings } = runPeer(
      fixture({
        peers: { vite: '^8.0.0', vue: '^3.5.0' },
        dev: { vite: '^8.3.0', vue: '^3.4.0' },
        locked: { vite: '8.3.0', vue: '3.4.9' },
      }),
    );
    expect(status).toBe(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('dependency peer gap: vue range excludes the tested version (cms)');
    expect(findings[0].severity).toBe('medium');
    expect(text(findings[0])).toContain('3.4.9');
    expect(typeof findings[0].proposedChange).toBe('string');
  });

  it("files a low finding when the peer range's lowest major is below the tested major", () => {
    const { findings } = runPeer(
      fixture({
        peers: { vite: '^7.0.0 || ^8.0.0', vue: '^3.5.0' },
        dev: { vite: '^8.3.0', vue: '^3.5.43' },
        locked: { vite: '8.3.0', vue: '3.5.43' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('dependency peer gap: vite admits untested 7.x (cms)');
    expect(findings[0].severity).toBe('low');
    expect(text(findings[0])).toContain('8.3.0');
  });

  it('treats an open-ended floor (>=7) under an 8.x dev install as an older-major gap too', () => {
    const { findings } = runPeer(
      fixture({ peers: { vite: '>=7.0.0' }, dev: { vite: '^8.3.0' }, locked: { vite: '8.3.0' } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('dependency peer gap: vite admits untested 7.x (cms)');
    expect(findings[0].severity).toBe('low');
  });

  it('files a low "unreadable" finding for a range the reader refuses to guess at (hyphen range)', () => {
    const { findings } = runPeer(
      fixture({ peers: { vite: '7.0.0 - 8.9.9' }, dev: { vite: '^8.3.0' }, locked: { vite: '8.3.0' } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('dependency peer range unreadable: vite (cms)');
    expect(findings[0].severity).toBe('low');
  });

  it('refuses x wildcards and prereleases too, rather than guessing', () => {
    const wild = runPeer(fixture({ peers: { vue: '3.x' }, dev: { vue: '^3.5.43' }, locked: { vue: '3.5.43' } }));
    expect(wild.findings.map((f) => f.title)).toEqual(['dependency peer range unreadable: vue (cms)']);
    const pre = runPeer(fixture({ peers: { vue: '^3.5.0-beta.1' }, dev: { vue: '^3.5.43' }, locked: { vue: '3.5.43' } }));
    expect(pre.findings.map((f) => f.title)).toEqual(['dependency peer range unreadable: vue (cms)']);
  });

  it('reads ^ ~ >= > <= < = comparators, spaces and ||', () => {
    const admitted = ['^3.5.0', '~3.5.0', '>=3.5.0', '>3.5.0 <4', '<=3.5.43', '3.5.43', '>= 3.5.0', '^2.0.0 || ^3.5.0'];
    for (const range of admitted) {
      const { findings } = runPeer(fixture({ peers: { vue: range }, dev: { vue: '^3.5.43' }, locked: { vue: '3.5.43' } }));
      const titles = findings.map((f) => f.title);
      expect(titles, `range ${range} admits 3.5.43`).not.toContain('dependency peer gap: vue range excludes the tested version (cms)');
    }
    const excluded = ['^3.6.0', '~3.4.0', '>3.5.43', '<3.5.43', '4.0.0', '>=4 || <3'];
    for (const range of excluded) {
      const { findings } = runPeer(fixture({ peers: { vue: range }, dev: { vue: '^3.5.43' }, locked: { vue: '3.5.43' } }));
      expect(
        findings.map((f) => f.title),
        `range ${range} excludes 3.5.43`,
      ).toContain('dependency peer gap: vue range excludes the tested version (cms)');
    }
  });

  it('ignores a peer dependency that has no matching devDependency to compare against', () => {
    const { findings } = runPeer(
      fixture({
        peers: { 'some-peer': '^1.0.0', vue: '^3.5.0' },
        dev: { vue: '^3.5.43' },
        locked: { vue: '3.5.43' },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('files nothing when package.json declares no peerDependencies', () => {
    const { pkg, lock } = fixture({ peers: {}, dev: { vue: '^3.5.43' }, locked: { vue: '3.5.43' } });
    delete pkg.peerDependencies;
    const { status, findings } = runPeer({ pkg, lock });
    expect(status).toBe(0);
    expect(findings).toEqual([]);
  });

  it('keeps the {title, detail, severity, proposedChange} contract on every finding', () => {
    const { findings } = runPeer(
      fixture({
        peers: { vite: '^7.0.0 || ^8.0.0', vue: '^3.5.0', pinia: '1.0.0 - 2.0.0' },
        dev: { vite: '^8.3.0', vue: '^3.4.0', pinia: '^2.1.0' },
        locked: { vite: '8.3.0', vue: '3.4.9', pinia: '2.1.0' },
      }),
    );
    expect(findings).toHaveLength(3);
    for (const f of findings) {
      expect(f.title).toMatch(PEER_TITLE);
      expect(typeof f.detail).toBe('string');
      expect(f.detail.length).toBeGreaterThan(0);
      expect(typeof f.proposedChange).toBe('string');
      expect(f.proposedChange.length).toBeGreaterThan(0);
      expect(SEVERITIES).toContain(f.severity);
    }
  });

  it('uses stable titles: no dates, no counts, identical across two runs of the same tree', () => {
    const opts = () =>
      fixture({
        peers: { vite: '^7.0.0 || ^8.0.0', vue: '^3.5.0' },
        dev: { vite: '^8.3.0', vue: '^3.4.0' },
        locked: { vite: '8.3.0', vue: '3.4.9' },
      });
    const a = runPeer(opts()).findings.map((f) => f.title);
    const b = runPeer(opts()).findings.map((f) => f.title);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    for (const title of a) {
      expect(title).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      expect(title).not.toMatch(/\b\d+ (gap|finding|package|peer)/i);
    }
  });

  it('files nothing about advisories or updates: only peer findings come out', () => {
    const { findings } = runPeer(
      fixture({
        peers: { vue: '^3.5.0' },
        dev: { vue: '^3.4.0' },
        locked: { vue: '3.4.9' },
      }),
    );
    for (const f of findings) expect(f.title).toMatch(/^dependency peer /);
  });
});

// ------------------------------------------------------- only speaks for cms

describe('peer-ranges scanner — only speaks for @koehler8/cms', () => {
  it('stays silent ([]) in a clone whose package.json is not @koehler8/cms, even with a peer gap', () => {
    const { status, findings } = runPeer(
      fixture({
        name: 'site-example',
        peers: { vue: '^3.5.0' },
        dev: { vue: '^3.4.0' },
        locked: { vue: '3.4.9' },
      }),
    );
    expect(status).toBe(0);
    expect(findings).toEqual([]);
  });

  it('stays silent in a non-cms clone with no lockfile (silent, not blind)', () => {
    const { pkg } = fixture({ name: 'site-example', peers: {}, dev: {}, locked: {} });
    const { status, findings } = runPeer({ pkg, lock: null });
    expect(status).toBe(0);
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------- never silently blind

describe('peer-ranges scanner — never silently blind', () => {
  const expectBlind = ({ status, findings, stderr }) => {
    expect(status, `scanner must exit 0 even when blind. stderr: ${stderr}`).toBe(0);
    expect(Array.isArray(findings)).toBe(true);
    expect(findings, 'a blind scanner must not print []').not.toEqual([]);
    const blind = findings.filter((f) => /peer-range scanner blind/i.test(f.title));
    expect(blind.length).toBeGreaterThanOrEqual(1);
    expect(blind[0].title).toMatch(PEER_BLIND);
    expect(blind[0].severity).toBe('medium');
    expect(blind[0].detail.length).toBeGreaterThan(0);
    return blind;
  };

  it('files a "peer-range scanner blind" finding when there is no package-lock.json', () => {
    const { pkg } = HEALTHY();
    expectBlind(runPeer({ pkg, lock: null }));
  });

  it('files a blind finding when package-lock.json does not parse', () => {
    const { pkg } = HEALTHY();
    expectBlind(runPeer({ pkg, lock: '{ not json' }));
  });

  it('files a blind finding when package-lock.json has no "packages" map', () => {
    const { pkg } = HEALTHY();
    expectBlind(runPeer({ pkg, lock: { lockfileVersion: 1, dependencies: {} } }));
  });

  it('files a blind finding when there is no package.json', () => {
    const { lock } = HEALTHY();
    expectBlind(runPeer({ pkg: null, lock }));
  });

  it('files a blind finding when package.json does not parse', () => {
    const { lock } = HEALTHY();
    expectBlind(runPeer({ pkg: '{ not json', lock }));
  });

  it('gives each blind cause its own stable title, with no counts or dates', () => {
    const { pkg, lock } = HEALTHY();
    const titleOf = (opts) => expectBlind(runPeer(opts))[0].title;
    const noLock = titleOf({ pkg, lock: null });
    expect(titleOf({ pkg, lock: null })).toBe(noLock);
    expect(noLock).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    const badLock = titleOf({ pkg, lock: '{ not json' });
    const noPkg = titleOf({ pkg: null, lock });
    expect(new Set([noLock, badLock, noPkg]).size).toBe(3);
  });

  it('never files the dependency scanner\'s own titles when blind', () => {
    const { pkg } = HEALTHY();
    for (const lock of [null, '{ not json']) {
      const { findings } = runPeer({ pkg, lock });
      expect(findings.filter((f) => /dependency scanner blind|dependency holds invalid/i.test(f.title))).toEqual([]);
    }
  });
});

// ----------------------------------------------------------- negative control

describe('peer-ranges scanner — its own negative control', () => {
  // The control is a built-in fixture the classifier is run through on every
  // scan; when its verdicts disagree with the fixture the scanner must say so
  // rather than print what a broken classifier computed. To prove the control
  // can fail, break the classifier in a throwaway copy of the scanner and run
  // that copy: the copy must report itself blind. The unbroken copy is the
  // reference, so a copy that cannot run at all cannot pass for a detection.
  const copyScanner = (mutate) => {
    const dir = makeDir('cms-peer-copy-');
    const file = path.join(dir, 'peer-ranges.mjs');
    copyFileSync(PEER_SCANNER, file);
    if (mutate) writeFileSync(file, mutate(readFileSync(file, 'utf8')));
    return file;
  };

  it('is silent on a healthy tree when the classifier is intact (reference copy)', () => {
    const { status, findings, stderr } = runIn(copyScanner(), HEALTHY());
    expect(status, stderr).toBe(0);
    expect(findings).toEqual([]);
  });

  it('files a medium "peer-range scanner blind" finding when the classifier is broken: low becomes info', () => {
    let changed = 0;
    const file = copyScanner((src) =>
      src.replace(/severity:\s*(["'])low\1/g, () => {
        changed += 1;
        return 'severity: "info"';
      }),
    );
    expect(changed, 'no `severity: "low"` found in peer-ranges.mjs to break').toBeGreaterThan(0);

    const { status, findings, stderr } = runIn(file, HEALTHY());
    expect(status, stderr).toBe(0);
    const blind = findings.filter((f) => PEER_BLIND.test(f.title));
    expect(blind, `a broken classifier must make the scanner blind, got: ${JSON.stringify(findings)}`).toHaveLength(1);
    expect(blind[0].severity).toBe('medium');
    expect(blind[0].title).toMatch(/control/i);
  });

  it('files the blind finding when the classifier is broken: the older-major test is inverted', () => {
    let changed = 0;
    const file = copyScanner((src) =>
      src.replace(/\[0\]\s*<\s*v\.major/g, () => {
        changed += 1;
        return '[0] > v.major';
      }),
    );
    expect(changed, 'no `[0] < v.major` found in peer-ranges.mjs to break').toBeGreaterThan(0);

    const { findings } = runIn(file, HEALTHY());
    expect(findings.filter((f) => PEER_BLIND.test(f.title))).toHaveLength(1);
  });
});

// ---------------------------------------- no finding title shared with dependencies.mjs

describe('peer-ranges scanner and dependencies scanner — no shared finding title', () => {
  // dependencies.mjs needs npm for `audit` and `view`; this stub answers both
  // with a clean audit and a registry that has newer releases of vue and vite,
  // so the dependency scanner has real findings of its own to compare.
  const NPM_STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'audit') {
  process.stdout.write(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} }));
  process.exit(0);
}
if (args[0] === 'view') {
  const dash = args.indexOf('--');
  const name = dash === -1 ? args[args.length - 2] : args[dash + 1];
  const versions = { vue: ['3.4.9', '3.5.99', '4.0.0'], vite: ['8.3.0', '8.9.0'] };
  if (versions[name]) { process.stdout.write(JSON.stringify(versions[name])); process.exit(0); }
  process.stdout.write(JSON.stringify({ error: { code: 'E404', summary: 'not found' } }));
  process.exit(1);
}
process.exit(1);
`;

  const bothRun = (opts) => {
    const bin = makeDir('cms-peer-bin-');
    writeFileSync(path.join(bin, 'npm'), NPM_STUB);
    chmodSync(path.join(bin, 'npm'), 0o755);
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    return {
      peer: runIn(PEER_SCANNER, { ...opts, env }).findings,
      dep: runIn(DEP_SCANNER, { ...opts, env }).findings,
    };
  };

  const scenarios = {
    'a tree with peer gaps, an unreadable range and newer releases': () =>
      fixture({
        peers: { vite: '^7.0.0 || ^8.0.0', vue: '^3.5.0', pinia: '1.0.0 - 2.0.0' },
        dev: { vite: '^8.3.0', vue: '^3.4.0', pinia: '^2.1.0' },
        locked: { vite: '8.3.0', vue: '3.4.9', pinia: '2.1.0' },
      }),
    'a tree with no lockfile': () => ({ pkg: HEALTHY().pkg, lock: null }),
    'a tree whose lockfile does not parse': () => ({ pkg: HEALTHY().pkg, lock: '{ not json' }),
  };

  for (const [label, make] of Object.entries(scenarios)) {
    it(`emits disjoint titles on ${label}`, () => {
      const { peer, dep } = bothRun(make());
      expect(Array.isArray(peer) && Array.isArray(dep)).toBe(true);
      expect(peer.length + dep.length).toBeGreaterThan(0);
      const shared = peer.map((f) => f.title).filter((t) => dep.some((g) => g.title === t));
      expect(shared).toEqual([]);
    });

    it(`keeps each scanner inside its own namespace on ${label}`, () => {
      const { peer, dep } = bothRun(make());
      for (const f of peer) {
        expect(f.title).toMatch(/^(dependency peer |peer-range scanner blind: )/);
        expect(f.title).not.toMatch(/dependency scanner blind|dependency holds invalid/i);
      }
      for (const f of dep) {
        expect(f.title).not.toMatch(/^dependency peer /);
        expect(f.title).not.toMatch(/peer-range scanner blind/i);
      }
    });
  }

  it('the dependency scanner files updates on the peer-gap tree while peer-ranges files none', () => {
    const { peer, dep } = bothRun(scenarios['a tree with peer gaps, an unreadable range and newer releases']());
    expect(dep.some((f) => /^dependency (update|major behind): /.test(f.title))).toBe(true);
    expect(peer.some((f) => /^dependency (update|major behind): /.test(f.title))).toBe(false);
  });
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

  it('can be imported without running a scan (main-module guard)', async () => {
    const { writes } = await load();
    expect(writes).toBe(0);
  });

  it('exports peerGapFindings', async () => {
    const { mod } = await load();
    expect(typeof mod.peerGapFindings).toBe('function');
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
    expect(found.find((f) => f.title.includes('vite')).severity).toBe('low');
    expect(found.find((f) => f.title.includes('vue') && !f.title.includes('vue-router')).severity).toBe('medium');
  });

  it('peerGapFindings: a package with no peerDependencies is []', async () => {
    const { mod } = await load();
    expect(mod.peerGapFindings({ name: '@koehler8/cms', devDependencies: { vue: '^3.5.43' } }, {}, 'cms')).toEqual([]);
  });
});
