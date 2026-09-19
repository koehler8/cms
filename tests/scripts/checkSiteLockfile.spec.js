import { describe, it, expect } from 'vitest';
import { checkLockfile } from '../../scripts/check-site-lockfile.mjs';

// A minimal lockfile shaped like a real consumer site's: rolldown and sharp
// each list their platform binaries as optionalDependencies, and every one of
// those has its own entry — which is what npm 10 writes on any platform.
function healthyLock() {
  const binary = (version) => ({
    version,
    resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
    integrity: 'sha512-x',
    optional: true,
  });
  return {
    lockfileVersion: 3,
    packages: {
      '': { name: '@koehler8/site-example' },
      'node_modules/vue': { version: '3.5.43', resolved: 'https://registry.npmjs.org/vue/-/vue-3.5.43.tgz' },
      'node_modules/rolldown': {
        version: '1.2.9',
        resolved: 'https://registry.npmjs.org/rolldown/-/rolldown-1.2.9.tgz',
        optionalDependencies: {
          '@rolldown/binding-linux-x64-gnu': '1.2.9',
          '@rolldown/binding-darwin-arm64': '1.2.9',
        },
      },
      'node_modules/@rolldown/binding-linux-x64-gnu': binary('1.2.9'),
      'node_modules/@rolldown/binding-darwin-arm64': binary('1.2.9'),
      'node_modules/sharp': {
        version: '0.35.4',
        resolved: 'https://registry.npmjs.org/sharp/-/sharp-0.35.4.tgz',
        optionalDependencies: { '@img/sharp-linux-x64': '0.35.4' },
      },
      'node_modules/@img/sharp-linux-x64': binary('0.35.4'),
      'node_modules/cms-theme-example': { resolved: 'themes/example', link: true },
    },
  };
}

describe('check-site-lockfile', () => {
  it('passes a healthy lockfile, including a site-local theme link', () => {
    expect(checkLockfile(healthyLock())).toEqual([]);
  });

  it('catches the Amplify-killing strip: a Linux binding listed by its parent but absent', () => {
    const lock = healthyLock();
    delete lock.packages['node_modules/@rolldown/binding-linux-x64-gnu'];

    const problems = checkLockfile(lock).join('\n');
    expect(problems).toMatch(/lists optional dependency "@rolldown\/binding-linux-x64-gnu"/);
    expect(problems).toMatch(/Amplify's Linux build will fail/);
  });

  it('judges by completeness, not by count — an upstream-dropped binding is fine', () => {
    // rolldown 1.2.9 really did drop wasm32-wasi; the entry and the parent's
    // listing disappear together, so nothing is missing.
    const lock = healthyLock();
    delete lock.packages['node_modules/rolldown'].optionalDependencies['@rolldown/binding-darwin-arm64'];
    delete lock.packages['node_modules/@rolldown/binding-darwin-arm64'];
    expect(checkLockfile(lock)).toEqual([]);
  });

  it('resolves an optional dependency nested under its parent', () => {
    const lock = healthyLock();
    lock.packages['node_modules/sharp/node_modules/@img/sharp-linux-x64'] =
      lock.packages['node_modules/@img/sharp-linux-x64'];
    lock.packages['node_modules/other'] = { version: '1.0.0', optionalDependencies: { fsevents: '2.3.3' } };
    lock.packages['node_modules/other/node_modules/fsevents'] = { version: '2.3.3', optional: true };
    expect(checkLockfile(lock)).toEqual([]);
  });

  it('flags a Linux binding that npm could not install (no resolved/integrity)', () => {
    const lock = healthyLock();
    lock.packages['node_modules/@img/sharp-linux-x64'] = { version: '0.35.4', optional: true };
    expect(checkLockfile(lock).join('\n')).toMatch(/@img\/sharp-linux-x64 has no resolved\/integrity/);
  });

  it('flags a second copy of a singleton', () => {
    const lock = healthyLock();
    lock.packages['node_modules/some-ext/node_modules/vue'] = { version: '3.4.0' };
    expect(checkLockfile(lock).join('\n')).toMatch(/2 copies of vue/);
  });

  it('flags a dependency resolved outside the npm registry', () => {
    const lock = healthyLock();
    lock.packages['node_modules/sketchy'] = { version: '1.0.0', resolved: 'https://example.com/sketchy.tgz' };
    expect(checkLockfile(lock).join('\n')).toMatch(/resolves outside the npm registry/);
  });

  it('flags a lockfile that is not v3', () => {
    expect(checkLockfile({ ...healthyLock(), lockfileVersion: 2 }).join('\n')).toMatch(/lockfileVersion is 2/);
  });
});
