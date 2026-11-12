import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The framework's dependency contract: what every consuming site inherits when
// it installs @koehler8/cms.
//
//  - fast-uri arrives only through ajv (`fast-uri ^3.0.1`), and the 3.x line
//    below 3.1.9 carries GHSA-w74x-v6f9-j3xg and GHSA-xhq7-xmqj-769h. Because
//    npm `overrides` only apply in a top-level project, the only way to force a
//    patched copy into a consumer's tree is for cms to depend on it directly.
//  - undici arrives through vite-ssg -> jsdom (`undici ^7.21.0`). Releases
//    below 7.30.1 carry GHSA-xjj6-f33q-929c and GHSA-4w7w-5xrc-9h26; the
//    lockfile must stay clear of them, and because a lockfile or `overrides`
//    entry never reaches a consumer, cms declares a patched floor directly
//    (same mechanism as fast-uri).
//  - sharp is a declared runtime dependency (image-variants pipeline) whose
//    lockfile pin must stay at or above the GHSA-wq5f-xc86-pv6w fix (0.35.5),
//    with its exact-pinned @img/sharp* platform packages moving in step.
//  - The peer floors must not trail what cms is developed and tested against,
//    or sites lock an older in-range version and get flagged.
//
// Everything here is a floor or a cross-file invariant, never a snapshot of an
// exact version, so it keeps holding as the repo moves forward.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const scaffold = readJson('templates/scaffolds/site/package.json');

// Lowest version a plain `^x.y.z` / `~x.y.z` / `>=x.y.z` / `x.y.z` range admits.
// Refuses anything fancier rather than guessing at it.
function rangeFloor(range) {
  const m = /^(?:\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(String(range).trim());
  if (!m) throw new Error(`unsupported range syntax: ${range}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) throw new Error(`unsupported version: ${version}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

const atLeast = (actual, floor) => cmp(actual, floor) >= 0;

// The versions cms is developed and tested against; peers may not sit below.
const PEER_FLOORS = {
  vite: '8.3.0',
  vue: '3.5.43',
  'vue-router': '5.3.1',
  '@vitejs/plugin-vue': '6.0.8',
};

describe('fast-uri advisory fix', () => {
  it('is a direct runtime dependency whose range cannot admit a vulnerable release', () => {
    expect(pkg.dependencies?.['fast-uri'], 'fast-uri must be in dependencies').toBeTruthy();
    expect(pkg.devDependencies?.['fast-uri']).toBeUndefined();
    expect(pkg.peerDependencies?.['fast-uri']).toBeUndefined();
    expect(atLeast(rangeFloor(pkg.dependencies['fast-uri']), [3, 1, 9])).toBe(true);
  });

  it('keeps fast-uri on a line ajv accepts (ajv requires ^3.0.1)', () => {
    expect(rangeFloor(pkg.dependencies['fast-uri'])[0]).toBe(3);
  });

  it('resolves every installed fast-uri in the lockfile to a patched release', () => {
    const entries = Object.entries(lock.packages).filter(
      ([key]) => key === 'node_modules/fast-uri' || key.endsWith('/node_modules/fast-uri'),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, entry] of entries) {
      expect(atLeast(parseVersion(entry.version), [3, 1, 9]), `${key} is ${entry.version}`).toBe(true);
      expect(entry.resolved, `${key} resolved`).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity, `${key} integrity`).toMatch(/^sha512-/);
    }
  });

  it('hoists a single fast-uri so the declared dependency and ajv share the patched copy', () => {
    const nested = Object.keys(lock.packages).filter((key) => key.endsWith('/node_modules/fast-uri'));
    expect(nested).toEqual([]);
    expect(lock.packages['node_modules/fast-uri']).toBeTruthy();
  });

  it('satisfies the range of its own dependent (ajv) as well as the one cms declares', () => {
    const ajvRange = lock.packages['node_modules/ajv']?.dependencies?.['fast-uri'];
    expect(ajvRange).toBeTruthy();
    const resolved = parseVersion(lock.packages['node_modules/fast-uri'].version);
    expect(atLeast(resolved, rangeFloor(ajvRange))).toBe(true);
    expect(resolved[0]).toBe(rangeFloor(ajvRange)[0]);
    expect(atLeast(resolved, rangeFloor(pkg.dependencies['fast-uri']))).toBe(true);
  });
});

describe('undici advisory fix (GHSA-xjj6-f33q-929c)', () => {
  // undici arrives only through vite-ssg -> jsdom (`undici ^7.21.0`), which is a
  // peer subtree consumers install. Releases in >=7.18.0 <7.30.1 let an excessive
  // content-encoding chain raise an unhandled error (denial of service). The
  // lockfile must stay clear of that window (the direct dependency floor is
  // pinned in the GHSA-4w7w-5xrc-9h26 block below).
  // A copy outside the window (a newer line, or removal) is always acceptable.
  const VULN_FROM = [7, 18, 0];
  const FIXED = [7, 30, 1];
  const entries = Object.entries(lock.packages).filter(
    ([key]) => key === 'node_modules/undici' || key.endsWith('/node_modules/undici'),
  );

  it('leaves no installed undici inside the vulnerable range', () => {
    for (const [key, entry] of entries) {
      const v = parseVersion(entry.version);
      const vulnerable = atLeast(v, VULN_FROM) && !atLeast(v, FIXED);
      expect(vulnerable, `${key} is ${entry.version}, inside >=7.18.0 <7.30.1`).toBe(false);
    }
  });

  it('keeps every installed undici tarball consistent with its recorded version', () => {
    for (const [key, entry] of entries) {
      expect(entry.resolved, `${key} resolved`).toBe(
        `https://registry.npmjs.org/undici/-/undici-${entry.version}.tgz`,
      );
      expect(entry.integrity, `${key} integrity`).toMatch(/^sha512-/);
    }
  });
});

describe('undici advisory fix (GHSA-4w7w-5xrc-9h26)', () => {
  // Releases in >=7.0.0 <7.30.1 allow cache poisoning and cross-user disclosure
  // via cross-origin redirects. undici reaches consumers only through the
  // vite-ssg peer -> jsdom (`undici ^7.21.0`), whose range admits vulnerable
  // releases, and npm `overrides` do not apply in a consumer's tree. So cms
  // declares undici as a direct dependency with a patched floor. No cms code
  // imports it; the declaration exists only to set that floor.
  const FIXED = [7, 30, 1];
  const isUndici = (key) => key === 'node_modules/undici' || key.endsWith('/node_modules/undici');
  const entries = Object.entries(lock.packages).filter(([key]) => isUndici(key));

  it('is a direct runtime dependency whose range cannot admit a vulnerable release', () => {
    expect(pkg.dependencies?.undici, 'undici must be in dependencies').toBeTruthy();
    expect(pkg.devDependencies?.undici).toBeUndefined();
    expect(pkg.peerDependencies?.undici).toBeUndefined();
    expect(atLeast(rangeFloor(pkg.dependencies.undici), FIXED)).toBe(true);
  });

  it('keeps undici on the 7.x line jsdom accepts', () => {
    expect(rangeFloor(pkg.dependencies.undici)[0]).toBe(7);
  });

  it('resolves every installed undici in the lockfile to a patched release', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, entry] of entries) {
      expect(atLeast(parseVersion(entry.version), FIXED), `${key} is ${entry.version}, below 7.30.1`).toBe(true);
      expect(entry.resolved, `${key} resolved`).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity, `${key} integrity`).toMatch(/^sha512-/);
    }
  });

  it('hoists a single undici so the declared dependency and jsdom share the patched copy', () => {
    const nested = Object.keys(lock.packages).filter((key) => key.endsWith('/node_modules/undici'));
    expect(nested).toEqual([]);
    expect(lock.packages['node_modules/undici']).toBeTruthy();
  });

  it('satisfies the range of its own dependent (jsdom) as well as the one cms declares', () => {
    const jsdomRange = lock.packages['node_modules/jsdom']?.dependencies?.undici;
    expect(jsdomRange).toBeTruthy();
    const resolved = parseVersion(lock.packages['node_modules/undici'].version);
    expect(atLeast(resolved, rangeFloor(jsdomRange))).toBe(true);
    expect(resolved[0]).toBe(rangeFloor(jsdomRange)[0]);
    expect(atLeast(resolved, rangeFloor(pkg.dependencies.undici))).toBe(true);
  });
});

describe('source-map-js advisory fix (GHSA-68fv-2mgg-jv7q)', () => {
  // source-map-js arrives only transitively (vite -> postcss, vue-router ->
  // @vue/compiler-sfc, jsdom -> css-tree, ...), always as `^1.2.1`, and cms does
  // not declare it. Releases in >=1.0.0 <1.2.2 let indexed source-map section
  // offsets block the event loop (denial of service). The lockfile is what must
  // stay clear of that window; a copy outside it (newer, or removal) is fine.
  const VULN_FROM = [1, 0, 0];
  const FIXED = [1, 2, 2];
  const entries = Object.entries(lock.packages).filter(
    ([key]) => key === 'node_modules/source-map-js' || key.endsWith('/node_modules/source-map-js'),
  );

  it('leaves no installed source-map-js inside the vulnerable range', () => {
    for (const [key, entry] of entries) {
      const v = parseVersion(entry.version);
      const vulnerable = atLeast(v, VULN_FROM) && !atLeast(v, FIXED);
      expect(vulnerable, `${key} is ${entry.version}, inside >=1.0.0 <1.2.2`).toBe(false);
    }
  });

  it('keeps every installed source-map-js tarball consistent with its recorded version', () => {
    for (const [key, entry] of entries) {
      expect(entry.resolved, `${key} resolved`).toBe(
        `https://registry.npmjs.org/source-map-js/-/source-map-js-${entry.version}.tgz`,
      );
      expect(entry.integrity, `${key} integrity`).toMatch(/^sha512-/);
    }
  });

  it('is not declared by cms itself (the fix is a lockfile move, not a new dependency)', () => {
    expect(pkg.dependencies?.['source-map-js']).toBeUndefined();
    expect(pkg.devDependencies?.['source-map-js']).toBeUndefined();
    expect(pkg.peerDependencies?.['source-map-js']).toBeUndefined();
    expect(pkg.optionalDependencies?.['source-map-js']).toBeUndefined();
  });
});

describe('sharp advisory fix (GHSA-wq5f-xc86-pv6w)', () => {
  // sharp < 0.35.5 bundles a librsvg with CVE-2026-96889. sharp is a runtime
  // dependency of the image-variants pipeline, so every consumer installs it.
  // `^0.35.3` already admits the fix, so the lockfile is what must not sit below
  // it. A newer release (or removal) is always acceptable.
  const FIXED = [0, 35, 5];
  const isSharp = (key) => key === 'node_modules/sharp' || key.endsWith('/node_modules/sharp');
  const sharpEntries = Object.entries(lock.packages).filter(([key]) => isSharp(key));

  it('keeps sharp a runtime dependency whose range admits the fix', () => {
    expect(pkg.dependencies?.sharp, 'sharp must stay in dependencies').toBeTruthy();
    // The locked copy must satisfy the declared range's floor (no drift the
    // other way), so the fix is reachable without touching package.json.
    expect(atLeast(parseVersion(lock.packages['node_modules/sharp'].version), rangeFloor(pkg.dependencies.sharp))).toBe(true);
  });

  it('leaves no installed sharp below the fixed release', () => {
    expect(sharpEntries.length).toBeGreaterThan(0);
    for (const [key, entry] of sharpEntries) {
      expect(atLeast(parseVersion(entry.version), FIXED), `${key} is ${entry.version}, below 0.35.5`).toBe(true);
    }
  });

  it('keeps every installed sharp tarball consistent with its recorded version', () => {
    for (const [key, entry] of sharpEntries) {
      expect(entry.resolved, `${key} resolved`).toBe(`https://registry.npmjs.org/sharp/-/sharp-${entry.version}.tgz`);
      expect(entry.integrity, `${key} integrity`).toMatch(/^sha512-/);
    }
  });

  it('moves every locked @img/sharp-* platform package to the version sharp pins', () => {
    for (const [key, entry] of sharpEntries) {
      const pins = entry.optionalDependencies || {};
      const platform = Object.entries(pins).filter(([name]) => /^@img\/sharp-(?!libvips)/.test(name));
      expect(platform.length, `${key} declares no @img/sharp-* optionalDependencies`).toBeGreaterThan(0);
      const scope = key.slice(0, -'sharp'.length);
      for (const [name, pinned] of platform) {
        const locked = lock.packages[`${scope}node_modules/${name}`] ?? lock.packages[`node_modules/${name}`];
        if (!locked) continue; // optional and absent for this platform set is not a mismatch
        expect(locked.version, `${name} locked at ${locked.version}, sharp@${entry.version} pins ${pinned}`).toBe(pinned);
        expect(locked.resolved, `${name} resolved`).toBe(
          `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${pinned}.tgz`,
        );
      }
    }
  });

  it('moves every locked @img/sharp-libvips-* package to the version its platform package pins', () => {
    const platformKeys = Object.keys(lock.packages).filter((key) => /^node_modules\/@img\/sharp-(?!libvips)/.test(key));
    expect(platformKeys.length).toBeGreaterThan(0);
    for (const key of platformKeys) {
      const entry = lock.packages[key];
      for (const [name, pinned] of Object.entries(entry.optionalDependencies || {})) {
        const locked = lock.packages[`node_modules/${name}`];
        if (!locked) continue;
        expect(locked.version, `${name} locked at ${locked.version}, ${key}@${entry.version} pins ${pinned}`).toBe(pinned);
      }
    }
  });

  it('keeps sharp installable on both Amplify Linux targets', () => {
    for (const [key, entry] of sharpEntries) {
      for (const name of ['@img/sharp-linux-x64', '@img/sharp-linuxmusl-x64']) {
        expect(entry.optionalDependencies?.[name], `${key} lacks ${name}`).toBeTruthy();
        const locked = lock.packages[`node_modules/${name}`];
        expect(locked, `${name} missing from the lockfile`).toBeTruthy();
        expect(locked.resolved).toBeTruthy();
        expect(locked.integrity).toMatch(/^sha512-/);
      }
    }
  });
});

describe('peerDependencies floors', () => {
  for (const [name, floor] of Object.entries(PEER_FLOORS)) {
    it(`${name} peer floor is at least ${floor}`, () => {
      expect(pkg.peerDependencies?.[name], `${name} must stay a peer`).toBeTruthy();
      expect(atLeast(rangeFloor(pkg.peerDependencies[name]), parseVersion(floor))).toBe(true);
    });

    it(`${name} peer floor never exceeds the version cms is tested against`, () => {
      const dev = pkg.devDependencies?.[name];
      expect(dev, `${name} must be a devDependency so cms is tested against it`).toBeTruthy();
      expect(atLeast(rangeFloor(dev), rangeFloor(pkg.peerDependencies[name]))).toBe(true);
    });
  }

  it('keeps vite-ssg as a peer on the 28.x line', () => {
    expect(rangeFloor(pkg.peerDependencies['vite-ssg'])[0]).toBe(28);
  });
});

describe('cms-create-site template', () => {
  for (const [name, floor] of Object.entries(PEER_FLOORS)) {
    it(`starts new sites with ${name} at or above ${floor}`, () => {
      const pinned = scaffold.dependencies?.[name];
      expect(pinned, `${name} missing from the scaffold`).toBeTruthy();
      expect(atLeast(rangeFloor(pinned), parseVersion(floor))).toBe(true);
    });

    it(`starts new sites with ${name} at or above cms's own peer floor`, () => {
      const pinned = scaffold.dependencies?.[name];
      expect(atLeast(rangeFloor(pinned), rangeFloor(pkg.peerDependencies[name]))).toBe(true);
    });
  }

  it('starts new sites with vite-ssg at or above the cms peer floor', () => {
    expect(atLeast(rangeFloor(scaffold.dependencies['vite-ssg']), rangeFloor(pkg.peerDependencies['vite-ssg']))).toBe(true);
  });
});

describe('lockfile root mirrors package.json', () => {
  // A hand-edited range in package.json that the lockfile root does not follow
  // makes `npm ci` fail on every consumer-facing install of this repo.
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    it(`packages[""].${field} matches package.json`, () => {
      expect(lock.packages[''][field]).toEqual(pkg[field]);
    });
  }
});
