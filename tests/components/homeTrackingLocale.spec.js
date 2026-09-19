import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@unhead/vue', () => ({ useHead: vi.fn() }));

// Capture the context getter Home.vue hands to the tracker. It is invoked per
// event, so calling it later reflects the locale at that moment.
let getContext = null;
vi.mock('../../src/composables/useEngagementTracking.js', () => ({
  useEngagementTracking: vi.fn((options) => {
    getContext = options.getContext;
    return { refreshVisibilityTargets: vi.fn(), resetEngagementTracking: vi.fn() };
  }),
}));

import Home from '../../src/components/Home.vue';
import { setConfigLoader, primeConfigSync } from '../../src/utils/loadConfig.js';

function makeConfig() {
  return {
    site: { title: 'Site' },
    shared: { content: {} },
    pages: { home: { path: '/', components: [], content: {}, meta: {} } },
  };
}

describe('Home.vue — engagement events report the rendered locale', () => {
  let loaderSpy;

  beforeEach(() => {
    getContext = null;
    try { localStorage.clear(); } catch { /* no-op */ }
    loaderSpy = vi.fn();
    setConfigLoader({ loadConfigData: loaderSpy, availableLocales: ['de', 'en'], baseLocale: 'en' });
  });

  afterEach(() => {
    try { localStorage.clear(); } catch { /* no-op */ }
  });

  it('reports the base locale code on an unprefixed route, not an empty string', async () => {
    primeConfigSync(undefined, makeConfig());

    const wrapper = mount(Home, { props: { pageId: 'home', pagePath: '/' } });
    await flushPromises();

    // An event-level `locale` overrides the tracking context's own, so ''
    // here used to blank the dimension for every base-locale page.
    expect(getContext().locale).toBe('en');
    expect(getContext().page_id).toBe('home');

    wrapper.unmount();
  });

  it('reports the restored saved locale once its content is on screen', async () => {
    primeConfigSync(undefined, makeConfig());
    localStorage.setItem('cms_locale', 'de');
    loaderSpy.mockResolvedValue(makeConfig());

    const wrapper = mount(Home, { props: { pageId: 'home', pagePath: '/' } });
    expect(getContext().locale).toBe('en');

    await flushPromises();
    await nextTick();

    expect(getContext().locale).toBe('de');

    wrapper.unmount();
  });

  it('reports the route locale on a prefixed route', async () => {
    primeConfigSync('de', makeConfig());

    const wrapper = mount(Home, { props: { pageId: 'home', pagePath: '/', locale: 'de' } });
    await flushPromises();

    expect(getContext().locale).toBe('de');

    wrapper.unmount();
  });
});
