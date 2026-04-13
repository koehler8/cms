import { describe, it, expect, vi } from 'vitest';
import { routes } from '../../src/router/index.js';
import { SUPPORTED_LOCALES } from '../../src/constants/locales.js';

describe('router', () => {
  describe('routes', () => {
    it('has a home route at /', () => {
      const home = routes.find((r) => r.path === '/');
      expect(home).toBeDefined();
      expect(home.name).toBe('Home');
      expect(home.props).toEqual({ pageId: 'home', pagePath: '/' });
    });

    it('has locale routes', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      expect(localeRoute).toBeDefined();
      expect(localeRoute.children).toBeDefined();
      expect(localeRoute.children.length).toBeGreaterThanOrEqual(2);
    });

    it('locale route pattern includes all supported locales', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      for (const locale of SUPPORTED_LOCALES) {
        expect(localeRoute.path).toContain(locale);
      }
    });

    it('has a catch-all dynamic page route', () => {
      const catchAll = routes.find((r) => r.name === 'DynamicPage');
      expect(catchAll).toBeDefined();
      expect(catchAll.path).toContain(':pathMatch');
    });

    it('locale children include HomeLocale and LocaleDynamicPage', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      const homeLocale = localeRoute.children.find((c) => c.name === 'HomeLocale');
      const dynamicPage = localeRoute.children.find((c) => c.name === 'LocaleDynamicPage');
      expect(homeLocale).toBeDefined();
      expect(dynamicPage).toBeDefined();
    });

    it('LocaleDynamicPage props normalizes slug segments', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      const dynamicPage = localeRoute.children.find((c) => c.name === 'LocaleDynamicPage');
      const props = dynamicPage.props({
        params: { pathMatch: ['docs', 'getting-started'], locale: 'en' },
      });
      expect(props.pagePath).toBe('/docs/getting-started');
      expect(props.locale).toBe('en');
    });

    it('LocaleDynamicPage handles single string pathMatch', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      const dynamicPage = localeRoute.children.find((c) => c.name === 'LocaleDynamicPage');
      const props = dynamicPage.props({
        params: { pathMatch: 'about', locale: 'fr' },
      });
      expect(props.pagePath).toBe('/about');
    });

    it('LocaleDynamicPage handles empty pathMatch', () => {
      const localeRoute = routes.find((r) => r.path.includes(':locale'));
      const dynamicPage = localeRoute.children.find((c) => c.name === 'LocaleDynamicPage');
      const props = dynamicPage.props({
        params: { pathMatch: '', locale: 'en' },
      });
      expect(props.pagePath).toBe('/');
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
});
