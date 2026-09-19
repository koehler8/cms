import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

// Capture the head factory so the spec can read what usePageMeta would emit
// at any moment (it is reactive — re-invoking it reflects the current refs).
let lastHeadFactory = null;
vi.mock('@unhead/vue', () => ({
  useHead: vi.fn((arg) => {
    lastHeadFactory = typeof arg === 'function' ? arg : () => arg;
  }),
}));

import { usePageConfig } from '../../src/composables/usePageConfig.js';
import { usePageMeta } from '../../src/composables/usePageMeta.js';
import {
  setConfigLoader,
  primeConfigSync,
  resolveContentLocale,
} from '../../src/utils/loadConfig.js';

function makeConfig(headline) {
  return {
    site: { title: 'Site', url: 'https://example.com' },
    shared: { content: {} },
    pages: {
      home: {
        path: '/',
        components: [{ name: 'Hero', enabled: true }],
        content: { hero: { headline } },
        meta: {},
      },
      about: {
        path: '/about',
        components: [{ name: 'Hero', enabled: true }],
        content: { hero: { headline: `${headline} (about)` } },
        meta: {},
      },
    },
  };
}

// Wires the two composables together exactly the way Home.vue does: the head
// is keyed off usePageConfig's contentLocale, not the route's locale prop.
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
      usePageMeta({
        siteData: api.siteData,
        currentPage: api.currentPage,
        locale: () => api.contentLocale.value,
      });
      return { ...api };
    },
    render() {
      return h('div');
    },
  });
  return mount(Harness, { props });
}

const head = () => lastHeadFactory();
const ogLocale = () => head().meta.find((m) => m.property === 'og:locale')?.content;
const canonical = () => head().link.find((l) => l.rel === 'canonical')?.href;

describe('contentLocale — <html lang> follows the rendered content (WCAG 3.1.1)', () => {
  let loaderSpy;

  beforeEach(() => {
    lastHeadFactory = null;
    try { localStorage.clear(); } catch { /* no-op */ }
    loaderSpy = vi.fn();
    setConfigLoader({ loadConfigData: loaderSpy, availableLocales: ['de', 'en'], baseLocale: 'en' });
  });

  afterEach(() => {
    try { localStorage.clear(); } catch { /* no-op */ }
  });

  it('restoring a saved locale onto the unprefixed URL moves lang with the content', async () => {
    // The server rendered `/` in the base locale (it has no localStorage).
    primeConfigSync(undefined, makeConfig('Hello'));
    // A returning visitor previously chose German.
    localStorage.setItem('cms_locale', 'de');
    loaderSpy.mockResolvedValue(makeConfig('Hallo'));

    const wrapper = mountPage();

    // First client render must reproduce the on-disk HTML — English content,
    // lang="en" — or hydration would mismatch.
    expect(wrapper.vm.pageContent.hero.headline).toBe('Hello');
    expect(wrapper.vm.contentLocale).toBe('en');
    expect(head().htmlAttrs.lang).toBe('en');

    await flushPromises();
    await nextTick();

    // German text is now on screen at `/`; the declared language follows it.
    expect(wrapper.vm.pageContent.hero.headline).toBe('Hallo');
    expect(wrapper.vm.contentLocale).toBe('de');
    expect(head().htmlAttrs.lang).toBe('de');
    // The rest of the head describes the same (German) page.
    expect(ogLocale()).toBe('de');
    expect(canonical()).toBe('https://example.com/de');

    wrapper.unmount();
  });

  it('keeps the restored locale across an in-SPA navigation between unprefixed routes', async () => {
    primeConfigSync(undefined, makeConfig('Hello'));
    localStorage.setItem('cms_locale', 'de');
    loaderSpy.mockResolvedValue(makeConfig('Hallo'));

    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    await wrapper.setProps({ pagePath: '/about' });
    await flushPromises();
    await nextTick();

    expect(wrapper.vm.pageContent.hero.headline).toBe('Hallo (about)');
    expect(head().htmlAttrs.lang).toBe('de');
    expect(canonical()).toBe('https://example.com/de/about');

    wrapper.unmount();
  });

  it('stays on the base locale when nothing is stored', async () => {
    primeConfigSync(undefined, makeConfig('Hello'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.vm.contentLocale).toBe('en');
    expect(head().htmlAttrs.lang).toBe('en');
    expect(canonical()).toBe('https://example.com/');

    wrapper.unmount();
  });

  it('a saved locale with no content on disk renders base content, so lang stays base', async () => {
    primeConfigSync(undefined, makeConfig('Hello'));
    localStorage.setItem('cms_locale', 'fr');
    // loadConfigData finds no fr/ tree and returns the base config.
    loaderSpy.mockResolvedValue(makeConfig('Hello'));

    const wrapper = mountPage();
    await flushPromises();
    await nextTick();

    expect(wrapper.vm.contentLocale).toBe('en');
    expect(head().htmlAttrs.lang).toBe('en');

    wrapper.unmount();
  });

  it('an explicit route locale wins over a different saved locale', async () => {
    primeConfigSync('de', makeConfig('Hallo'));
    localStorage.setItem('cms_locale', 'en');

    const wrapper = mountPage({ locale: 'de' });
    await flushPromises();

    expect(wrapper.vm.contentLocale).toBe('de');
    expect(head().htmlAttrs.lang).toBe('de');
    expect(loaderSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('navigating from a locale route back to the base URL returns lang to base only once base content lands', async () => {
    primeConfigSync('de', makeConfig('Hallo'));
    // The header's locale dropdown writes the explicit choice before navigating.
    localStorage.setItem('cms_locale', 'en');
    let resolveLoad;
    loaderSpy.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));

    const wrapper = mountPage({ locale: 'de' });
    await wrapper.setProps({ locale: null });
    await nextTick();

    // Load still in flight: nothing English has been applied yet.
    expect(wrapper.vm.contentLocale).toBe('de');

    resolveLoad(makeConfig('Hello'));
    await flushPromises();
    await nextTick();

    expect(wrapper.vm.pageContent.hero.headline).toBe('Hello');
    expect(wrapper.vm.contentLocale).toBe('en');
    expect(head().htmlAttrs.lang).toBe('en');

    wrapper.unmount();
  });
});

describe('resolveContentLocale', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* no-op */ }
    setConfigLoader({ loadConfigData: vi.fn(), availableLocales: ['de', 'en'], baseLocale: 'en' });
  });

  afterEach(() => {
    try { localStorage.clear(); } catch { /* no-op */ }
  });

  it('returns the explicit locale, normalized', () => {
    expect(resolveContentLocale('DE')).toBe('de');
  });

  it('falls back to the saved locale when it has content on disk', () => {
    localStorage.setItem('cms_locale', 'de');
    expect(resolveContentLocale(undefined)).toBe('de');
  });

  it('falls back to base when nothing is saved, or the saved locale has no content', () => {
    expect(resolveContentLocale(undefined)).toBe('en');
    localStorage.setItem('cms_locale', 'fr');
    expect(resolveContentLocale(undefined)).toBe('en');
  });
});
