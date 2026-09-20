import { describe, it, expect } from 'vitest';
import {
  classifyDrift,
  copiesOf,
  checkPeer,
  entryName,
  parseArgs,
  reachableFrom,
  satisfies,
} from '../../tools/fleet/check-lockfile-drift.mjs';

// Shaped like the nine crypto-declaring sites: the wallet tree arrives through
// the extension, so `ethers` is nobody's direct dependency and `ws` is pinned
// exactly by ethers — which is the whole reason piece B is a lockfile-only bump.
function siteLock({ ethers = '6.16.0', ws = '8.17.1', reown = '1.8.19', vue = '3.5.43' } = {}) {
  return {
    lockfileVersion: 3,
    packages: {
      '': {
        name: '@koehler8/site-example',
        dependencies: { '@koehler8/cms': '^1.3.1', '@koehler8/cms-ext-crypto': '^1.0.0-beta.4', vue: '^3.5.43' },
      },
      'node_modules/@koehler8/cms': { version: '1.3.1', peerDependencies: { vue: '^3.5.0' } },
      'node_modules/@koehler8/cms-ext-crypto': {
        version: '1.0.0-beta.4',
        dependencies: { ethers: `^6.13.5`, '@reown/appkit': '^1.8.12' },
        peerDependencies: { pinia: '^3.0.0' },
      },
      'node_modules/ethers': { version: ethers, dependencies: { ws: ws, '@noble/hashes': '1.8.0' } },
      'node_modules/ws': { version: ws },
      'node_modules/@noble/hashes': { version: '1.8.0' },
      'node_modules/@reown/appkit': { version: reown, dependencies: { viem: '2.40.0' } },
      'node_modules/viem': { version: '2.40.0' },
      'node_modules/vue': { version: vue },
      'node_modules/pinia': { version: '3.0.4' },
    },
  };
}

describe('check-lockfile-drift — classifyDrift', () => {
  it('accepts the named package and what it pins: ethers 6.16 -> 6.17 drags ws', () => {
    const after = siteLock({ ethers: '6.17.0', ws: '8.21.0' });
    const result = classifyDrift(siteLock(), after, ['ethers', 'viem', 'ws']);
    expect(result.unexpected).toEqual([]);
    expect(result.expected.map((item) => `${item.name} ${item.from}->${item.to}`)).toEqual([
      'ethers 6.16.0->6.17.0',
      'ws 8.17.1->8.21.0',
    ]);
  });

  it('rejects a package that is neither named nor a dependency of one', () => {
    // @reown/appkit DEPENDS ON viem; viem does not depend on reown, so a reown
    // move is drift even on a run that names viem. This is the guard that keeps
    // 4-day-old wallet-connection code out of a lockfile-only bump.
    const after = siteLock({ ethers: '6.17.0', ws: '8.21.0', reown: '1.8.24' });
    const result = classifyDrift(siteLock(), after, ['ethers', 'viem', 'ws']);
    expect(result.unexpected.map((item) => item.name)).toEqual(['@reown/appkit']);
  });

  it('does not follow peerDependencies as edges', () => {
    // cms peers vue. Naming cms must not silently license a vue move.
    const after = siteLock({ vue: '3.6.0' });
    const result = classifyDrift(siteLock(), after, ['@koehler8/cms']);
    expect(result.unexpected.map((item) => item.name)).toEqual(['vue']);
  });

  it('counts a metadata-only change as a change', () => {
    const before = siteLock();
    const after = siteLock();
    after.packages['node_modules/vue'] = { version: '3.5.43', integrity: 'sha512-rewritten' };
    const result = classifyDrift(before, after, ['ethers']);
    expect(result.unexpected).toEqual([
      { key: 'node_modules/vue', name: 'vue', from: '3.5.43', to: '3.5.43' },
    ]);
  });

  it('ignores a reordering of an entry’s own fields', () => {
    const before = siteLock();
    const after = siteLock();
    after.packages['node_modules/ethers'] = { dependencies: { '@noble/hashes': '1.8.0', ws: '8.17.1' }, version: '6.16.0' };
    expect(classifyDrift(before, after, ['ethers']).expected).toEqual([]);
  });

  it('allows an added entry reachable from a named package', () => {
    const after = siteLock({ ethers: '6.17.0' });
    after.packages['node_modules/ethers'].dependencies['aes-js'] = '4.0.0';
    after.packages['node_modules/aes-js'] = { version: '4.0.0' };
    const result = classifyDrift(siteLock(), after, ['ethers']);
    expect(result.unexpected).toEqual([]);
    expect(result.expected.map((item) => item.name)).toContain('aes-js');
  });

  it('allows a removed entry that was reachable in the BEFORE tree', () => {
    const before = siteLock();
    const after = siteLock({ ethers: '6.17.0' });
    delete after.packages['node_modules/@noble/hashes'];
    delete after.packages['node_modules/ethers'].dependencies['@noble/hashes'];
    const result = classifyDrift(before, after, ['ethers']);
    expect(result.unexpected).toEqual([]);
    expect(result.expected.find((item) => item.name === '@noble/hashes')).toMatchObject({ to: null });
  });

  it('reaches a nested copy through its own parent, not the hoisted one', () => {
    const before = siteLock();
    before.packages['node_modules/ethers/node_modules/ws'] = { version: '8.17.1' };
    before.packages['node_modules/ethers'].dependencies.ws = '8.17.1';
    const after = JSON.parse(JSON.stringify(before));
    after.packages['node_modules/ethers/node_modules/ws'].version = '8.21.0';
    const result = classifyDrift(before, after, ['ethers']);
    expect(result.unexpected).toEqual([]);
    expect(result.expected[0].key).toBe('node_modules/ethers/node_modules/ws');
  });

  it('judges the root entry by declared range, and only a named package may move', () => {
    const before = siteLock();
    const after = siteLock();
    after.packages[''].dependencies['@koehler8/cms'] = '^1.4.0';
    after.packages[''].dependencies.vue = '^3.6.0';
    const result = classifyDrift(before, after, ['@koehler8/cms']);
    expect(result.rootRanges).toEqual([
      { block: 'dependencies', name: '@koehler8/cms', from: '^1.3.1', to: '^1.4.0', allowed: true },
      { block: 'dependencies', name: 'vue', from: '^3.5.43', to: '^3.6.0', allowed: false },
    ]);
  });

  it('flags a non-range field appearing on the root entry (an engines edit rides here)', () => {
    const before = siteLock();
    const after = siteLock();
    after.packages[''].engines = { node: '>=22.22.2' };
    expect(classifyDrift(before, after, ['ethers']).rootOther).toEqual(['engines']);
  });

  it('reports nothing at all when the two lockfiles are identical', () => {
    const result = classifyDrift(siteLock(), siteLock(), ['ethers']);
    expect(result).toEqual({ expected: [], unexpected: [], rootRanges: [], rootOther: [] });
  });
});

describe('check-lockfile-drift — tree helpers', () => {
  it('entryName reads the last path segment, scope included', () => {
    expect(entryName('node_modules/a/node_modules/@scope/b')).toBe('@scope/b');
    expect(entryName('')).toBe('');
  });

  it('copiesOf finds nested duplicates, which is what a second pinia looks like', () => {
    const lock = siteLock();
    lock.packages['node_modules/@koehler8/cms/node_modules/pinia'] = { version: '4.0.3' };
    expect(copiesOf(lock, 'pinia')).toEqual([
      'node_modules/pinia',
      'node_modules/@koehler8/cms/node_modules/pinia',
    ]);
  });

  it('reachableFrom includes optionalDependencies (the platform binaries)', () => {
    const lock = siteLock();
    lock.packages['node_modules/ethers'].optionalDependencies = { bufferutil: '4.0.0' };
    lock.packages['node_modules/bufferutil'] = { version: '4.0.0' };
    expect(reachableFrom(lock.packages, ['ethers'])).toContain('node_modules/bufferutil');
  });
});

describe('check-lockfile-drift — satisfies', () => {
  it('reads the range vue-router 5.3.1 declares for pinia', () => {
    expect(satisfies('4.0.3', '^3.0.4 || ^4.0.2')).toBe(true);
    expect(satisfies('3.0.4', '^3.0.4 || ^4.0.2')).toBe(true);
    expect(satisfies('3.0.1', '^3.0.4 || ^4.0.2')).toBe(false);
    expect(satisfies('4.0.1', '^3.0.4 || ^4.0.2')).toBe(false);
    expect(satisfies('5.0.0', '^3.0.4 || ^4.0.2')).toBe(false);
  });

  it('implements semver’s two caret special cases for 0.x', () => {
    expect(satisfies('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
    expect(satisfies('0.0.9', '^0.0')).toBe(true);
    expect(satisfies('0.1.0', '^0.0')).toBe(false);
    expect(satisfies('0.9.0', '^0')).toBe(true);
    expect(satisfies('1.0.0', '^0')).toBe(false);
  });

  it('handles partials, tilde, inequalities, conjunction and *', () => {
    expect(satisfies('3.9.9', '^3')).toBe(true);
    expect(satisfies('4.0.0', '^3')).toBe(false);
    expect(satisfies('3.1.9', '~3.1')).toBe(true);
    expect(satisfies('3.2.0', '~3.1')).toBe(false);
    expect(satisfies('22.23.2', '>=20.19.0 <23')).toBe(true);
    expect(satisfies('23.0.0', '>=20.19.0 <23')).toBe(false);
    expect(satisfies('1.0.0', '*')).toBe(true);
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '1.2.3')).toBe(false);
  });

  it('REFUSES syntax it does not implement rather than guessing', () => {
    expect(() => satisfies('1.2.3', '1.0.0 - 2.0.0')).toThrow(/does not implement/);
    expect(() => satisfies('1.2.3', '^1.0.0-beta.1')).toThrow(/does not implement/);
    expect(() => satisfies('1.2.3', '1.x')).toThrow();
    expect(() => satisfies('1.2.3-rc.1', '^1.0.0')).toThrow(/plain x\.y\.z/);
    expect(() => satisfies('1.2.3', '')).toThrow(/empty range/);
  });
});

describe('check-lockfile-drift — checkPeer', () => {
  const lock = () => ({
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/vue-router': { version: '5.3.1', peerDependencies: { pinia: '^3.0.4 || ^4.0.2', vue: '^3.5.0' } },
      'node_modules/pinia': { version: '4.0.3' },
      'node_modules/vue': { version: '3.5.43' },
    },
  });

  it('passes when the locked version satisfies the declared peer', () => {
    expect(checkPeer(lock(), 'vue-router', 'pinia')).toEqual({
      status: 'ok', dependent: 'vue-router', peer: 'pinia', range: '^3.0.4 || ^4.0.2', version: '4.0.3',
    });
  });

  it('fails when it does not — the pinia 3 tree under a vue-router that wants 4', () => {
    const tree = lock();
    tree.packages['node_modules/pinia'].version = '3.0.1';
    expect(checkPeer(tree, 'vue-router', 'pinia').status).toBe('unmet');
  });

  it('reports an unmet peer with nothing installed at all', () => {
    const tree = lock();
    delete tree.packages['node_modules/pinia'];
    expect(checkPeer(tree, 'vue-router', 'pinia')).toMatchObject({ status: 'unmet', version: null });
  });

  it('does not fail an OPTIONAL peer that is absent', () => {
    const tree = lock();
    delete tree.packages['node_modules/pinia'];
    tree.packages['node_modules/vue-router'].peerDependenciesMeta = { pinia: { optional: true } };
    expect(checkPeer(tree, 'vue-router', 'pinia').status).toBe('optional-absent');
  });

  it('distinguishes "package absent" from "not a peer of it"', () => {
    expect(checkPeer(lock(), 'nope', 'pinia').status).toBe('absent');
    expect(checkPeer(lock(), 'vue-router', 'ethers').status).toBe('not-a-peer');
  });
});

describe('check-lockfile-drift — parseArgs', () => {
  it('collects repeatable options and positional lockfile paths', () => {
    const { positional, options } = parseArgs(
      ['a.json', 'b.json', '--allow', 'ethers', '--allow', 'ws', '--single', 'pinia', '--peer', 'vue-router:pinia', '--json']
    );
    expect(positional).toEqual(['a.json', 'b.json']);
    expect(options).toEqual({ allow: ['ethers', 'ws'], single: ['pinia'], peer: ['vue-router:pinia'], json: true });
  });

  it('refuses an unknown flag and a flag with no value', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown option/);
    expect(() => parseArgs(['--allow'])).toThrow(/needs a value/);
  });
});
