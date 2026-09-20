import { describe, it, expect } from 'vitest';

import { currentRouteHref } from '../../src/utils/currentRoute.js';

// The regression this pins: on the client there is no ctx at all, and falling
// through to START_LOCATION made the config cache key 'default' on every page.
// On a locale-prefixed route that never matched the SSG's stamped
// `siteConfigLocale`, so priming was skipped and the client re-fetched the whole
// config tree on the critical path instead of using the payload it was served.
describe('currentRouteHref', () => {
  const location = (pathname, search = '') => ({ pathname, search });

  it('prefers the SSG route path when vite-ssg supplies one', () => {
    expect(currentRouteHref({ routePath: '/th/lacquer/' }, location('/'))).toBe('/th/lacquer/');
  });

  it('uses the window location on the client, where there is no ctx at all', () => {
    // vite-ssg calls the client setup fn with no argument.
    expect(currentRouteHref(undefined, location('/th/lacquer/'))).toBe('/th/lacquer/');
    expect(currentRouteHref(null, location('/th/lacquer/'))).toBe('/th/lacquer/');
    expect(currentRouteHref({}, location('/th/lacquer/'))).toBe('/th/lacquer/');
  });

  it('keeps the query string, which the router needs to resolve some routes', () => {
    expect(currentRouteHref({}, location('/de/catalog/', '?page=2'))).toBe('/de/catalog/?page=2');
  });

  it('defers to a context that already carries a resolved route', () => {
    expect(currentRouteHref({ route: { path: '/fr/' } }, location('/th/'))).toBeNull();
  });

  it('returns null on the server, where there is no location to read', () => {
    expect(currentRouteHref({}, null)).toBeNull();
    expect(currentRouteHref({}, undefined)).toBeNull();
    expect(currentRouteHref({}, {})).toBeNull();
  });

  it('ignores a blank or non-string route path rather than resolving nonsense', () => {
    expect(currentRouteHref({ routePath: '' }, location('/th/'))).toBe('/th/');
    expect(currentRouteHref({ routePath: 42 }, location('/th/'))).toBe('/th/');
    expect(currentRouteHref({ routePath: '' }, null)).toBeNull();
  });
});
