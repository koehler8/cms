import { ViteSSG } from 'vite-ssg';
import { createPinia } from 'pinia';
import { createHead } from '@unhead/vue/client';

import App from './App.vue';
import { routes, resolveHistory, applyRouterGuards } from './router/index.js';

import { shouldEnableAnalytics, scheduleAnalyticsLoad, configureAnalyticsConsentMode } from './utils/cookieConsent.js';
import { loadConfigData, primeConfigSync, trimConfigToPage, resolvePageIdForRoute } from './utils/loadConfig.js';
import { persistAttributionFromLocation } from './utils/trackingContext.js';
import { applyThemeVariables } from './themes/themeManager.js';
import { setActiveThemeKey } from './utils/themeColors.js';
import { ensureSiteStylesLoaded } from './utils/siteStyles.js';
import { runExtensionSetups } from './extensions/extensionLoader.js';

const normalizeThemeKey = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length ? trimmed.toLowerCase() : '';
};

const extractThemeKey = (siteData) => {
  if (!siteData || typeof siteData !== 'object') return '';
  const site = siteData.site && typeof siteData.site === 'object' ? siteData.site : {};
  if (typeof site.theme === 'string' && site.theme.trim()) {
    return site.theme.trim();
  }
  if (site.theme && typeof site.theme === 'object') {
    if (typeof site.theme.key === 'string' && site.theme.key.trim()) {
      return site.theme.key.trim();
    }
    if (typeof site.theme.name === 'string' && site.theme.name.trim()) {
      return site.theme.name.trim();
    }
  }
  if (typeof site.themeKey === 'string' && site.themeKey.trim()) {
    return site.themeKey.trim();
  }
  return '';
};

const applySiteTheme = (themeKey, head) => {
  const normalized = normalizeThemeKey(themeKey);

  // No theme configured — leave `<html>` without `data-site-theme` so
  // none of the `:root[data-site-theme="X"]` rules in the bundled
  // virtual:cms-theme-vars.css apply. Components fall back to their
  // hardcoded CSS defaults. Sites that intentionally want the bundled
  // `base` palette must opt in via `"theme": "base"` in site.json (or
  // any locale's site.json).
  //
  // (The implicit auto-apply of `base` was removed in 1.0.0-beta.12.
  // It hid configuration mistakes — sites that registered a theme but
  // forgot to activate it silently rendered with `base` instead of the
  // theme they intended. Surfacing the misconfiguration via "no theme
  // applied" is more honest.)
  if (!normalized) {
    return;
  }

  // Push the html attribute via @unhead so `data-site-theme="X"` lands
  // in the SSR-rendered HTML *before* Vue hydrates. Theme CSS selectors
  // (`:root[data-site-theme="X"]`) then apply during the very first
  // paint, eliminating the need for site-side critical-CSS overrides.
  if (head && typeof head.push === 'function') {
    head.push({ htmlAttrs: { 'data-site-theme': normalized } });
  }

  // Client only: also set the attribute imperatively (so runtime theme
  // switching is reflected immediately) and inline the CSS variable map
  // for themes that ship JS-only design tokens (e.g. the bundled `base`
  // theme has no theme.css).
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.siteTheme = normalized;
    applyThemeVariables(normalized);
  }
};

export function createCmsApp() {
  ensureSiteStylesLoaded();

  if (typeof window !== 'undefined') {
    persistAttributionFromLocation();
  }

  return ViteSSG(
    App,
    {
      routes,
      history: resolveHistory(),
    },
    async (ctx) => {
      const { app, router, isClient, initialState } = ctx;
      const pinia = createPinia();
      app.use(pinia);

      const existingHead = app._context?.provides?.usehead;
      const headInstance = existingHead || createHead();
      if (!existingHead) {
        app.use(headInstance);
      }
      ctx.head = headInstance;

      if (initialState.siteTheme) {
        setActiveThemeKey(initialState.siteTheme);
        applySiteTheme(initialState.siteTheme, ctx.head);
      }

      applyRouterGuards(router);

      const pickLocaleParam = (value) => {
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (typeof entry === 'string') {
              const trimmed = entry.trim();
              if (trimmed.length) {
                return trimmed;
              }
            }
          }
          return undefined;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length ? trimmed : undefined;
        }
        return undefined;
      };

      const normalizeLocaleKey = (value) => {
        if (typeof value !== 'string' || !value.trim()) {
          return 'default';
        }
        return value.trim().toLowerCase();
      };

      const extractCurrentRoute = () => {
        // During SSG, vite-ssg passes the route being pre-rendered as a string
        // on `ctx.routePath` and only pushes the router AFTER this setup fn runs
        // — so `router.currentRoute` is still vue-router's START_LOCATION ('/')
        // here, identically on every page. Resolve `routePath` through the router
        // (a pure match, no navigation) to recover the real path + `params.locale`.
        // Without this, `resolveCurrentPageId` sees '/' for every route, so the
        // payload trim targets the wrong page — or, when '/' is ambiguous, none.
        const routePath = ctx?.routePath;
        if (typeof routePath === 'string' && routePath) {
          try {
            return router.resolve(routePath);
          } catch {
            return { path: routePath, params: {} };
          }
        }
        if (ctx?.route) {
          return ctx.route;
        }
        const maybeRoute = router?.currentRoute;
        if (maybeRoute && typeof maybeRoute === 'object' && 'value' in maybeRoute) {
          return maybeRoute.value;
        }
        return null;
      };

      // SSG only: resolve the route being pre-rendered to its page id so the
      // embedded config can be trimmed to that single page when the site opts
      // into `site.trimInitialState`. The matching rules live in the pure,
      // unit-tested resolvePageIdForRoute (returns null on ambiguity → keep the
      // full config, a safe no-op).
      const resolveCurrentPageId = (config) => {
        const route = extractCurrentRoute();
        const rawPath = typeof route?.path === 'string' ? route.path : '';
        const localeParam = pickLocaleParam(route?.params?.locale);
        return resolvePageIdForRoute(config, rawPath, localeParam);
      };

      const loadSiteConfig = async (options = {}) => {
        const requestedLocale =
          pickLocaleParam(options.locale) ??
          pickLocaleParam(extractCurrentRoute()?.params?.locale);

        const localeKey = normalizeLocaleKey(requestedLocale);

        if (initialState.siteConfig && initialState.siteConfigLocale === localeKey) {
          const existingTheme =
            initialState.siteTheme ?? normalizeThemeKey(extractThemeKey(initialState.siteConfig));
          initialState.siteTheme = existingTheme;
          setActiveThemeKey(existingTheme);
          applySiteTheme(existingTheme, ctx.head);
          // Expose the server-resolved config for the first synchronous client
          // render (see usePageConfig.hydrateFromSyncCache) so the prerendered
          // DOM isn't replaced by an empty render while the async loader runs.
          primeConfigSync(localeKey, initialState.siteConfig);
          return initialState.siteConfig;
        }

        const siteData = await loadConfigData({ locale: requestedLocale });
        const themeKey = normalizeThemeKey(extractThemeKey(siteData));
        initialState.siteConfig = siteData;
        initialState.siteConfigLocale = localeKey;
        initialState.siteTheme = themeKey;
        setActiveThemeKey(themeKey);
        applySiteTheme(themeKey, ctx.head);
        return siteData;
      };

      if (!isClient) {
        try {
          await loadSiteConfig();
          // Payload trim (default ON since 1.0.0; opt out with
          // `"trimInitialState": false`): embed only the current page's config
          // in window.__INITIAL_STATE__ rather than every page's (the
          // full-site blob is byte-identical on every page and can dominate
          // page weight — measured 81% of page bytes on a profiled site).
          // The rendered HTML body is unaffected — usePageConfig resolves the
          // SSR render from its own loadConfigData() call, not from
          // initialState — so this only shrinks the serialized hydration blob.
          // Safety valve: an ambiguous route→page match returns null and the
          // full config is embedded (a no-op, never a broken page).
          if (initialState.siteConfig?.site?.trimInitialState !== false) {
            const currentPageId = resolveCurrentPageId(initialState.siteConfig);
            if (currentPageId) {
              initialState.siteConfig = trimConfigToPage(initialState.siteConfig, currentPageId);
            }
          }
        } catch (error) {
          console.error('Failed to load site configuration during SSG build', error);
        }
        return;
      }

      let siteData;
      try {
        siteData = await loadSiteConfig();
        configureAnalyticsConsentMode(siteData?.site?.analytics?.consentMode);
        if (shouldEnableAnalytics()) {
          const googleId = siteData?.site?.googleId;
          if (googleId) scheduleAnalyticsLoad(googleId);
        }
      } catch (error) {
        console.error('Failed to load site configuration on client', error);
      }

      await runExtensionSetups({ app, router, pinia, siteData, isClient });
    }
  );
}

// CSS imports — framework-owned styles
import './styles/base.css';
import './styles/layout.css';
import './styles/theme-base.css';
