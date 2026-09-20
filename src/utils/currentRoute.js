// Which href the app should resolve through the router to learn the route it is
// actually on.
//
// Both halves of the lifecycle are blind to this in the same way, for the same
// reason: vite-ssg runs the setup fn BEFORE `app.use(router)`, so
// `router.currentRoute` is still vue-router's START_LOCATION ('/', `params: {}`)
// — identically on every page.
//
//   - During SSG, vite-ssg hands the route being pre-rendered over as a string on
//     `ctx.routePath`, so that is authoritative.
//   - On the CLIENT it calls the setup fn with no argument at all: no
//     `ctx.routePath`, no `ctx.route`. The only authoritative source left is the
//     window's own location.
//
// Falling through to START_LOCATION on the client is not a cosmetic miss. The
// config cache key is derived from `params.locale`, so it came out 'default' on
// every page while the SSG had stamped the real locale on `siteConfigLocale`.
// The two never matched on a locale-prefixed route, `primeConfigSync` was
// skipped, and the client discarded the embedded payload and re-fetched the
// whole config tree on the critical path — the exact regression the priming
// machinery exists to prevent. Measured on sparkbang.com/th/<piece>/ before the
// fix: 151 JS requests / 405 KB, 112 of them per-piece config chunks, while the
// 17 KB embedded payload was parsed and thrown away.
//
// Pure and dependency-free so the fall-through can be pinned by a unit test;
// `main.js` owns the router.resolve() call itself (a pure match, no navigation).
//
// Returns null when the caller should use `ctx.route` as-is, or when there is
// nothing authoritative to resolve and START_LOCATION is genuinely all there is.

/**
 * @param {{routePath?: unknown, route?: unknown}|null|undefined} ctx
 *   The vite-ssg setup context. `routePath` is set during SSG only.
 * @param {{pathname?: unknown, search?: unknown}|null|undefined} location
 *   `window.location` on the client; omit/null on the server.
 * @returns {string|null} the href to resolve, or null to fall back.
 */
export function currentRouteHref(ctx, location) {
  const routePath = ctx?.routePath;
  if (typeof routePath === 'string' && routePath) return routePath;
  // A context that already carries a resolved route needs no href at all.
  if (ctx?.route) return null;
  const pathname = location?.pathname;
  if (typeof pathname === 'string' && pathname) {
    const search = typeof location?.search === 'string' ? location.search : '';
    return `${pathname}${search}`;
  }
  return null;
}
