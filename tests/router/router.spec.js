import { describe, it, expect } from 'vitest';
import { buildRoutes } from '../../src/router/index.js';
import { SUPPORTED_LOCALES } from '../../src/constants/locales.js';

describe('router buildRoutes', () => {
  describe('single-locale site (only base on disk)', () => {
    const routes = buildRoutes([]);

    it('has a home route at /', () => {
      const home = routes.find((r) => r.path === '/');
      expect(home).toBeDefined();
      expect(home.name).toBe('Home');
      expect(home.props).toEqual({ pageId: 'home', pagePath: '/' });
    });

    it('has a catch-all dynamic page route', () => {
      const catchAll = routes.find((r) => r.name === 'DynamicPage');
      expect(catchAll).toBeDefined();
      expect(catchAll.path).toContain(':pathMatch');
    });

    it('does NOT register a locale-prefixed route', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      expect(localeRoute).toBeUndefined();
    });

    it('contains exactly two routes (home + catch-all)', () => {
      expect(routes.length).toBe(2);
    });
  });

  describe('multi-locale site (en base + de, fr on disk)', () => {
    const routes = buildRoutes(['de', 'fr']);

    it('has a home route at /', () => {
      const home = routes.find((r) => r.path === '/');
      expect(home).toBeDefined();
      expect(home.props).toEqual({ pageId: 'home', pagePath: '/' });
    });

    it('locale route includes only non-base locales', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      expect(localeRoute).toBeDefined();
      expect(localeRoute.path).toContain('de');
      expect(localeRoute.path).toContain('fr');
      expect(localeRoute.path).not.toContain('en');
    });

    it('locale route children include HomeLocale and LocaleDynamicPage', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      const homeLocale = localeRoute.children.find((c) => c.name === 'HomeLocale');
      const dynamicPage = localeRoute.children.find((c) => c.name === 'LocaleDynamicPage');
      expect(homeLocale).toBeDefined();
      expect(dynamicPage).toBeDefined();
    });

    it('LocaleDynamicPage props normalizes slug segments', () => {
      const routes = buildRoutes(['de', 'fr']);
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      const dynamicPage = localeRoute.children.find((c) => c.name === 'LocaleDynamicPage');
      const props = dynamicPage.props({
        params: { pathMatch: ['docs', 'getting-started'], locale: 'de' },
      });
      expect(props.pagePath).toBe('/docs/getting-started');
      expect(props.locale).toBe('de');
    });

    it('LocaleDynamicPage handles single string pathMatch', () => {
      const routes = buildRoutes(['de', 'fr']);
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      const dynamicPage = localeRoute.children.find((c) => c.name === 'LocaleDynamicPage');
      const props = dynamicPage.props({
        params: { pathMatch: 'about', locale: 'fr' },
      });
      expect(props.pagePath).toBe('/about');
    });

    it('LocaleDynamicPage handles empty pathMatch', () => {
      const routes = buildRoutes(['de', 'fr']);
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      const dynamicPage = localeRoute.children.find((c) => c.name === 'LocaleDynamicPage');
      const props = dynamicPage.props({
        params: { pathMatch: '', locale: 'de' },
      });
      expect(props.pagePath).toBe('/');
    });

    it('preserves catch-all route after locale-prefixed route', () => {
      const catchAll = routes.find((r) => r.name === 'DynamicPage');
      expect(catchAll).toBeDefined();
    });
  });
});

describe('SUPPORTED_LOCALES', () => {
  it('includes common locales', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('fr');
    expect(SUPPORTED_LOCALES).toContain('es');
    expect(SUPPORTED_LOCALES).toContain('de');
    expect(SUPPORTED_LOCALES).toContain('ja');
  });

  it('is a non-empty array', () => {
    expect(Array.isArray(SUPPORTED_LOCALES)).toBe(true);
    expect(SUPPORTED_LOCALES.length).toBeGreaterThan(0);
  });
});
