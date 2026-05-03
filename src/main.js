import { ViteSSG } from 'vite-ssg';
import { createPinia } from 'pinia';
import { createHead } from '@unhead/vue/client';

import App from './App.vue';
import { routes, resolveHistory, applyRouterGuards } from './router/index.js';

import { shouldEnableAnalytics, scheduleAnalyticsLoad } from './utils/cookieConsent.js';
import { loadConfigData } from './utils/loadConfig.js';
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
  const resolved = normalized || 'base';

  // Push the html attribute via @unhead so `data-site-theme="X"` lands
  // in the SSR-rendered HTML *before* Vue hydrates. Theme CSS selectors
  // (`:root[data-site-theme="X"]`) then apply during the very first
  // paint, eliminating the need for site-side critical-CSS overrides.
  if (head && typeof head.push === 'function') {
    head.push({ htmlAttrs: { 'data-site-theme': resolved } });
  }

  // Client only: also set the attribute imperatively (so runtime theme
  // switching is reflected immediately) and inline the CSS variable map
  // for themes that ship JS-only design tokens (e.g. the bundled `base`
  // theme has no theme.css).
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.siteTheme = resolved;
    applyThemeVariables(resolved);
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
        if (ctx?.route) {
          return ctx.route;
        }
        const maybeRoute = router?.currentRoute;
        if (maybeRoute && typeof maybeRoute === 'object' && 'value' in maybeRoute) {
          return maybeRoute.value;
        }
        return null;
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
        } catch (error) {
          console.error('Failed to load site configuration during SSG build', error);
        }
        return;
      }

      let siteData;
      try {
        siteData = await loadSiteConfig();
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
