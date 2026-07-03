import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

import { usePageConfig } from '../../src/composables/usePageConfig.js';
import {
  setConfigLoader,
  primeConfigSync,
  peekConfigSync,
} from '../../src/utils/loadConfig.js';

// A minimal object shaped like loadConfigData's output.
function makeConfig(componentNames, { headline = 'Hello' } = {}) {
  return {
    site: {},
    shared: { content: {} },
    pages: {
      home: {
        path: '/',
        components: componentNames.map((name) => ({ name, enabled: true })),
        content: { hero: { headline } },
        meta: {},
      },
    },
  };
}

// Mount a tiny component that runs usePageConfig and exposes its refs on vm.
function mountPage(props = {}) {
  const Harness = defineComponent({
    props: {
      pagePath: { type: String, default: '/' },
      locale: { type: String, default: null },
    },
    setup(p) {
      const api = usePageConfig({
        pagePath: () => p.pagePath,
        locale: () => p.locale,
      });
      return { ...api };
    },
    render() {
      return h('div');
    },
  });
  return mount(Harness, { props });
}

describe('usePageConfig — synchronous first render (white-flash fix)', () => {
  let loaderSpy;

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* no-op */ }
    loaderSpy = vi.fn();
    // setConfigLoader also clears the sync cache between tests.
    setConfigLoader({ loadConfigData: loaderSpy, availableLocales: ['en'], baseLocale: 'en' });
  });

  afterEach(() => {
    try { localStorage.clear(); } catch { /* no-op */ }
  });

  it('renders content synchronously from a primed cache without awaiting the loader', () => {
    primeConfigSync(undefined, makeConfig(['Hero', 'Footer']));

    const wrapper = mountPage();

    // Populated on the very first (synchronous) render — no flush, no await.
    // This is the fix: the first client render reproduces the prerendered DOM
    // instead of an empty <main>, so there is no paint -> blank -> paint flash.
    expect(wrapper.vm.componentKeys.map((c) => c.name)).toEqual(['Hero', 'Footer']);
    expect(wrapper.vm.pageContent.hero.headline).toBe('Hello');
    // The async loader must not be touched on a cache hit.
    expect(loaderSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('falls back to the async loader (empty first render) on a cache miss', async () => {
    loaderSpy.mockResolvedValue(makeConfig(['Hero']));

    const wrapper = mountPage();

    // Previous behavior is preserved as the fallback: first render is empty
    // until the async load resolves.
    expect(wrapper.vm.componentKeys).toEqual([]);
    expect(loaderSpy).toHaveBeenCalledTimes(1);

    await flushPromises();
    await nextTick();

    expect(wrapper.vm.componentKeys.map((c) => c.name)).toEqual(['Hero']);

    wrapper.unmount();
  });

  it('preserves a saved-locale switch via a soft post-render reconcile (no blank-out)', async () => {
    // The server rendered the base locale (no localStorage on the server).
    primeConfigSync(undefined, makeConfig(['Hero'], { headline: 'Hello' }));
    // A returning visitor previously chose "de".
    localStorage.setItem('locale', 'de');
    loaderSpy.mockResolvedValue(makeConfig(['Hero', 'LocaleBanner'], { headline: 'Hallo' }));

    const wrapper = mountPage();

    // First paint still matches the server (base, non-empty — never blanks).
    expect(wrapper.vm.componentKeys.map((c) => c.name)).toEqual(['Hero']);

    // The saved locale is reconciled after the first render.
    await flushPromises();
    await nextTick();
    expect(loaderSpy).toHaveBeenCalled();
    expect(wrapper.vm.componentKeys.map((c) => c.name)).toEqual(['Hero', 'LocaleBanner']);
    expect(wrapper.vm.pageContent.hero.headline).toBe('Hallo');

    wrapper.unmount();
  });

  it('does not reconcile when no locale is stored (pure synchronous render)', async () => {
    primeConfigSync(undefined, makeConfig(['Hero']));

    const wrapper = mountPage();
    await flushPromises();

    // No stored locale → no soft reload; the loader is never called.
    expect(loaderSpy).not.toHaveBeenCalled();
    expect(wrapper.vm.componentKeys.map((c) => c.name)).toEqual(['Hero']);

    wrapper.unmount();
  });
});

describe('usePageConfig — trimmed (partial) embedded config', () => {
  let loaderSpy;

  const fullTwoPage = () => ({
    site: {},
    shared: { content: {} },
    pages: {
      home: { path: '/', components: [{ name: 'Hero', enabled: true }], content: {}, meta: {} },
      about: { path: '/about', components: [{ name: 'AboutBody', enabled: true }], content: {}, meta: {} },
    },
  });

  // What the server embeds when site.trimInitialState is on for the home route:
  // site + shared + only the home page, flagged partial.
  const partialHome = () => {
    const cfg = fullTwoPage();
    return { site: cfg.site, shared: cfg.shared, pages: { home: cfg.pages.home }, pagesPartial: true };
  };

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* no-op */ }
    loaderSpy = vi.fn();
    setConfigLoader({ loadConfigData: loaderSpy, availableLocales: ['en'], baseLocale: 'en' });
  });

  afterEach(() => {
    try { localStorage.clear(); } catch { /* no-op */ }
  });

  it('paints the current page synchronously, then background-loads the full config so nav resolves other pages', async () => {
    primeConfigSync(undefined, partialHome());
    loaderSpy.mockResolvedValue(fullTwoPage());

    const wrapper = mountPage({ pagePath: '/' });

    // First paint: home renders synchronously from the partial embed (no flash).
    expect(wrapper.vm.componentKeys.map((c) => c.name)).toEqual(['Hero']);

    // A partial embed triggers one soft background reload of the full config.
    await flushPromises();
    await nextTick();
    expect(loaderSpy).toHaveBeenCalledTimes(1);

    // In-SPA navigation now resolves another page — it would fall through to the
    // NotFound sentinel if the trimmed config were still the navigation source.
    await wrapper.setProps({ pagePath: '/about' });
    await flushPromises();
    await nextTick();
    expect(wrapper.vm.componentKeys.map((c) => c.name)).toEqual(['AboutBody']);

    wrapper.unmount();
  });

  it('does not background-reload when the embed is full (pagesPartial absent)', async () => {
    primeConfigSync(undefined, fullTwoPage());

    const wrapper = mountPage({ pagePath: '/' });
    await flushPromises();

    expect(loaderSpy).not.toHaveBeenCalled();
    expect(wrapper.vm.componentKeys.map((c) => c.name)).toEqual(['Hero']);

    wrapper.unmount();
  });
});

describe('config sync cache (primeConfigSync / peekConfigSync)', () => {
  beforeEach(() => {
    setConfigLoader({ loadConfigData: vi.fn(), availableLocales: [], baseLocale: 'en' });
  });

  it('round-trips a config by normalized locale key', () => {
    const cfg = makeConfig(['Hero']);
    primeConfigSync('EN', cfg);
    expect(peekConfigSync('en')).toBe(cfg);
    expect(peekConfigSync(' en ')).toBe(cfg);
  });

  it('treats undefined/empty locale as the default key', () => {
    const cfg = makeConfig(['Hero']);
    primeConfigSync(undefined, cfg);
    expect(peekConfigSync(undefined)).toBe(cfg);
    expect(peekConfigSync('')).toBe(cfg);
    expect(peekConfigSync('default')).toBe(cfg);
  });

  it('returns null on a miss and ignores non-object configs', () => {
    expect(peekConfigSync('fr')).toBeNull();
    primeConfigSync('fr', null);
    primeConfigSync('fr', 'nope');
    expect(peekConfigSync('fr')).toBeNull();
  });

  it('setConfigLoader clears the cache', () => {
    primeConfigSync('it', makeConfig(['Hero']));
    expect(peekConfigSync('it')).not.toBeNull();
    setConfigLoader({ loadConfigData: vi.fn(), availableLocales: [], baseLocale: 'en' });
    expect(peekConfigSync('it')).toBeNull();
  });
});
