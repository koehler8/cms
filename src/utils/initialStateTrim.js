// Site-supplied trimming of the serialized hydration payload.
//
// `trimConfigToPage` (utils/loadConfig.js) prunes `config.pages` to the page
// being prerendered. It cannot touch `config.shared`, because deciding which
// parts of shared content a given ROUTE needs requires knowledge the framework
// does not have — a site's own notion of what a route resolves to.
//
// That gap is expensive for content-heavy sites. On one 737-page site, shared
// content accounted for 61% of ALL built HTML bytes: every page carried every
// item's body, in every locale, so a single story page shipped fifty times the
// prose it rendered.
//
// A site registers a function here; the framework calls it once per prerendered
// route, after the page trim, and stamps `sharedPartial: true` when the hook
// actually changed something. usePageConfig treats that marker exactly like
// `pagesPartial` — a background reload of the full config after hydration — so
// anything the hook prunes is restored before it can be navigated to.
//
// Contract for hook authors:
//   * SYNCHRONOUS and pure. This runs once per route (hundreds to thousands of
//     times per build, per shard); an async hook that does I/O multiplies build
//     time by the route count.
//   * Return the config UNCHANGED (same reference) to no-op. Anything that is
//     not a plain object is ignored.
//   * Never drop `site`, `shared` or `pages` wholesale. Framework components on
//     pages your hook never reasons about read those directly (useIntroGate,
//     FooterMinimal, ComingSoon, NotFound, Header), and a first client render
//     without them is a hydration mismatch on every page's chrome.
//
// The framework stamps the marker rather than the site, so a hook cannot forget
// it and ship a payload that is permanently short with nothing to repair it.

const hooks = [];

/**
 * Register a trim hook. Called at module-eval time from the generated entry
 * (see vite-plugin.js `initialStateTrims`), which is what makes this reachable
 * during SSG — extension setups run only on the client.
 *
 * @param {(config: object, context: {routePath: string, locale: string|undefined, pageId: string|null, route: object|null}) => object} fn
 */
export function registerInitialStateTrim(fn) {
  if (typeof fn === 'function') hooks.push(fn);
}

/** Test helper — drops every registered hook. */
export function clearInitialStateTrims() {
  hooks.length = 0;
}

/** Test helper — how many hooks are registered. */
export function initialStateTrimCount() {
  return hooks.length;
}

/**
 * Run every registered hook in registration order, threading the config
 * through. Returns the ORIGINAL reference when nothing changed, so the caller
 * can distinguish "trimmed" from "no-op" without the hook having to say so.
 */
export function applyInitialStateTrims(config, context) {
  if (!hooks.length) return config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;

  let current = config;
  let changed = false;

  for (const fn of hooks) {
    let next;
    try {
      next = fn(current, context);
    } catch (error) {
      // A payload optimisation failing is not a page failing. Deliberately NOT
      // the '[cms-ssg] PAGE CONFIG LOAD FAILED' marker the build greps for.
      console.warn('[@koehler8/cms] an initialStateTrim hook threw; skipping it', error);
      continue;
    }

    if (!next || typeof next !== 'object' || Array.isArray(next)) continue;  // ignored
    if (next === current) continue;                                          // explicit no-op

    // Blast-radius guard: a hook must not be able to blank the config for a
    // whole build. Losing any of these three is a hydration mismatch on chrome
    // that appears on every page.
    if (current.site && !next.site) continue;
    if (current.shared && !next.shared) continue;
    if (current.pages && !next.pages) continue;

    current = next;
    changed = true;
  }

  return changed ? { ...current, sharedPartial: true } : config;
}
