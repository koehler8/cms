import { createRouter, createMemoryHistory, createWebHistory, RouterView } from 'vue-router';
import { h } from 'vue';

import Home from '../components/Home.vue';

import { availableLocales, baseLocale } from '../utils/loadConfig.js';

// Test for `/{baseLocale}` or `/{baseLocale}/...` paths — these no longer
// pre-render or match the locale layout (the canonical URL for the base
// locale is unprefixed). Used by the router guard to redirect in-SPA
// navigation so external clicks land on the canonical URL instead of the
// SPA catch-all → 404 path.
function stripBaseLocalePrefix(targetPath, base) {
  if (!base || !targetPath) return null;
  const root = `/${base}`;
  if (targetPath === root) return '/';
  if (targetPath.startsWith(`${root}/`)) return targetPath.slice(root.length) || '/';
  return null;
}

const LocaleLayout = {
  name: 'LocaleLayout',
  render() {
    return h(RouterView);
  },
};

// Locales that should match the `/:locale/...` route — every available
// locale on disk EXCEPT the base. The base locale is served at the
// unprefixed path; emitting `/{baseLocale}/path` would be a duplicate URL.
//
// Read at module-load time. The vite-plugin's generated entry calls
// setConfigLoader() synchronously before importing the app, so by the
// time this module is evaluated (inside main.js), the singletons are
// populated.
function computeLocalePrefixes() {
  if (!Array.isArray(availableLocales)) return [];
  return availableLocales.filter((l) => typeof l === 'string' && l !== baseLocale);
}

export function buildRoutes(localePrefixes = computeLocalePrefixes()) {
  const homeRoute = {
    path: '/',
    name: 'Home',
    component: Home,
    props: { pageId: 'home', pagePath: '/' },
  };

  const catchAllRoute = {
    path: '/:pathMatch(.*)*',
    name: 'DynamicPage',
    component: Home,
    props: (route) => ({ pagePath: route.path || '/' }),
  };

  if (!localePrefixes.length) {
    // Single-locale site: don't register the locale-prefixed route at all.
    // `/de/about` etc. fall into the catch-all → DynamicPage with a
    // pagePath that won't match any page → home fallback.
    return [homeRoute, catchAllRoute];
  }

  return [
    homeRoute,
    {
      path: `/:locale(${localePrefixes.join('|')})`,
      component: LocaleLayout,
      children: [
        {
          path: '',
          name: 'HomeLocale',
          component: Home,
          props: (route) => ({ pageId: 'home', pagePath: '/', locale: route.params.locale }),
        },
        {
          path: ':pathMatch(.*)*',
          name: 'LocaleDynamicPage',
          component: Home,
          props: (route) => {
            const pathMatch = route.params.pathMatch;
            const slugSegments = Array.isArray(pathMatch) ? pathMatch : [pathMatch || ''];
            const rawSlug = `/${slugSegments.filter(Boolean).join('/')}`;
            const normalizedSlug = rawSlug.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
            return { pagePath: normalizedSlug, locale: route.params.locale };
          },
        },
      ],
    },
    catchAllRoute,
  ];
}

export const routes = buildRoutes();

function normalizeLocale(value = '') {
  return value.toLowerCase().split('-')[0];
}

export function applyRouterGuards(router, localePrefixes = computeLocalePrefixes()) {
  router.beforeEach((to) => {
    // SPA-side redirect for stale base-locale-prefixed URLs. When a user
    // navigates inside the app to `/en/about` (and `en` is base), the URL
    // doesn't pre-render and the catch-all renders the 404 page. Rewrite
    // to the canonical unprefixed equivalent. Direct external hits to
    // these URLs still need an Amplify customRule on the host side — see
    // CLAUDE.md "URL hygiene".
    const stripped = stripBaseLocalePrefix(to.path, baseLocale);
    if (stripped !== null && stripped !== to.path) {
      return { path: stripped, replace: true };
    }

    const rawLocale = (to.params.locale || '').toString().trim();

    if (rawLocale) {
      const normalized = normalizeLocale(rawLocale);

      if (!localePrefixes.includes(normalized)) {
        return { path: '/', replace: true };
      }

      if (rawLocale !== normalized) {
        const rest = to.fullPath.replace(/^\/[a-zA-Z-]{2,5}/, '');
        return { path: `/${normalized}${rest || ''}`.replace(/\/$/, ''), replace: true };
      }

      if (!import.meta.env.SSR) {
        try {
          document.documentElement.lang = normalized;
        } catch {}
        try {
          localStorage.setItem('locale', normalized);
        } catch {}
      }

      return;
    }

    if (!import.meta.env.SSR) {
      // Browser-language auto-redirect on first visit only. If the user
      // already has a stored locale preference (set by either an explicit
      // dropdown click or a previous visit to a locale-prefixed URL),
      // respect that — don't second-guess them with browser-language
      // detection. This prevents the bug where clicking "EN" on /de
      // navigates to / and the auto-detect bounces back to /de because
      // the browser is set to German.
      let storedPreference = '';
      try {
        storedPreference = (localStorage.getItem('locale') || '').toString().toLowerCase();
      } catch {}
      if (storedPreference) return;

      const navLang = (navigator.language || navigator.userLanguage || '').toString();
      const shortLang = normalizeLocale(navLang || '');

      if (to.path === '/' && localePrefixes.includes(shortLang)) {
        return { path: `/${shortLang}`, replace: true };
      }
    }
  });
}

export function resolveHistory(base = import.meta.env.BASE_URL) {
  return import.meta.env.SSR ? createMemoryHistory(base) : createWebHistory(base);
}

export function createRouterInstance() {
  const router = createRouter({
    history: resolveHistory(),
    routes,
  });

  applyRouterGuards(router);

  return router;
}

export default createRouterInstance;
