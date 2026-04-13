import { createRouter, createMemoryHistory, createWebHistory, RouterView } from 'vue-router';
import { h } from 'vue';

import Home from '../components/Home.vue';

import { SUPPORTED_LOCALES } from '../constants/locales.js';

const LocaleLayout = {
  name: 'LocaleLayout',
  render() {
    return h(RouterView);
  },
};

export const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home,
    props: { pageId: 'home', pagePath: '/' },
  },
  {
    path: `/:locale(${SUPPORTED_LOCALES.join('|')})`,
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
  {
    path: '/:pathMatch(.*)*',
    name: 'DynamicPage',
    component: Home,
    props: (route) => ({ pagePath: route.path || '/' }),
  },
];

function normalizeLocale(value = '') {
  return value.toLowerCase().split('-')[0];
}

export function applyRouterGuards(router) {
  router.beforeEach((to) => {
    const rawLocale = (to.params.locale || '').toString().trim();

    if (rawLocale) {
      const normalized = normalizeLocale(rawLocale);

      if (!SUPPORTED_LOCALES.includes(normalized)) {
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
      const navLang = (navigator.language || navigator.userLanguage || '').toString();
      const shortLang = normalizeLocale(navLang || '');

      if (to.path === '/' && SUPPORTED_LOCALES.includes(shortLang)) {
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
