import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { h } from 'vue';
import { applyRouterGuards } from '../../src/router/index.js';
import { setConfigLoader } from '../../src/utils/loadConfig.js';

const Stub = { render: () => h('div') };

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Stub },
      { path: '/about', component: Stub },
      { path: '/:locale(de|fr)', component: Stub },
      { path: '/:locale(de|fr)/about', component: Stub },
      { path: '/:pathMatch(.*)*', component: Stub },
    ],
  });
}

beforeEach(() => {
  localStorage.clear();
  // The guard reads baseLocale from the config-loader singleton.
  setConfigLoader({
    loadConfigData: async () => ({}),
    availableLocales: ['en', 'de', 'fr'],
    baseLocale: 'en',
  });
});

describe('applyRouterGuards', () => {
  it('redirects /{baseLocale}/... to the canonical unprefixed path', async () => {
    const router = makeRouter();
    applyRouterGuards(router, ['de', 'fr']);
    await router.push('/en/about');
    expect(router.currentRoute.value.path).toBe('/about');
  });

  it('leaves non-base locale routes alone and persists the locale preference', async () => {
    const router = makeRouter();
    applyRouterGuards(router, ['de', 'fr']);
    await router.push('/de/about');
    expect(router.currentRoute.value.path).toBe('/de/about');
    expect(localStorage.getItem('cms_locale')).toBe('de');
  });

  it('bounces an unknown locale prefix to home', async () => {
    const router = makeRouter();
    applyRouterGuards(router, ['de', 'fr']);
    // /:locale regex only admits de|fr, so /xx/about lands in the catch-all
    // with no locale param — but a matched-yet-unregistered prefix is the
    // interesting branch: simulate by narrowing the registered prefixes.
    const narrow = makeRouter();
    applyRouterGuards(narrow, ['de']);
    await narrow.push('/fr/about');
    expect(narrow.currentRoute.value.path).toBe('/');
  });

  it('respects a stored locale preference instead of browser-language detection', async () => {
    localStorage.setItem('cms_locale', 'de');
    const router = makeRouter();
    applyRouterGuards(router, ['de', 'fr']);
    await router.push('/');
    // Stored preference short-circuits the auto-redirect: stay put.
    expect(router.currentRoute.value.path).toBe('/');
  });
});
