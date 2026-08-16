import { describe, it, expect, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useComponentResolver } from '../../src/composables/useComponentResolver.js';
import { setSiteComponents, registry as bundledRegistry } from '../../src/utils/componentRegistry.js';

const SiteThing = { name: 'SiteThing', render: () => null };

function resolve(componentKeys, { pageContent = {}, currentPage = { id: 'home' }, registry = bundledRegistry } = {}) {
  const { loadedComponents } = useComponentResolver({
    componentKeys: ref(componentKeys),
    pageContent: ref(pageContent),
    currentPage: ref(currentPage),
    registry,
  });
  return loadedComponents.value;
}

beforeEach(() => {
  setSiteComponents({});
});

describe('useComponentResolver', () => {
  it('resolves bundled components by bare name', () => {
    const resolved = resolve(['Hero', 'Footer']);
    expect(resolved).toHaveLength(2);
    expect(resolved.every((entry) => entry && entry.component)).toBe(true);
  });

  it('silently drops unknown names (the gap the build-time validator now closes)', () => {
    const resolved = resolve(['Hero', 'Nope']);
    expect(resolved).toHaveLength(1);
  });

  it('resolves site-local components, including site:-qualified references', () => {
    setSiteComponents({ './SiteThing.vue': { default: SiteThing } });
    const bare = resolve(['SiteThing']);
    const qualified = resolve(['site:SiteThing']);
    expect(bare).toHaveLength(1);
    expect(qualified).toHaveLength(1);
    expect(qualified[0].component).toBe(SiteThing);
  });

  it('site-local components shadow bundled ones of the same name', () => {
    const SiteHero = { name: 'SiteHero', render: () => null };
    setSiteComponents({ './Hero.vue': { default: SiteHero } });
    const resolved = resolve(['Hero']);
    expect(resolved[0].component).toBe(SiteHero);
  });

  it('skips entries with enabled: false', () => {
    const resolved = resolve([{ name: 'Hero', enabled: false }, 'Footer']);
    expect(resolved).toHaveLength(1);
  });
});
