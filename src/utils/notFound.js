/**
 * Single source of truth for "is this page the not-found page".
 *
 * A site can author `pages/404.json` to give the 404 its own chrome and copy.
 * That page necessarily carries `path: "/404"` so the plugin pre-renders it and
 * can copy `dist/404/index.html` → `dist/404.html`. The consequence is that it
 * is also an ordinary route: resolving by id or by path matches it directly,
 * before `selectPage`'s not-found fallback ever runs.
 *
 * Without a shared check, those direct resolutions produce a page that looks
 * ordinary to everything downstream — `usePageMeta` emits a canonical and skips
 * the `noindex`, `sitemapGenerator` lists it, and breadcrumbs are derived for
 * it. The result is an indexable, sitemapped /404, which is the opposite of what
 * authoring the page was supposed to achieve.
 *
 * Both the runtime (usePageConfig → usePageMeta) and the build (sitemapGenerator)
 * import from here so they cannot disagree about what counts.
 */

/** Page id the framework reserves for a site-authored not-found page. */
export const NOT_FOUND_PAGE_ID = '404';

/** Route the not-found page is pre-rendered at. */
export const NOT_FOUND_PATH = '/404';

/**
 * Normalize a page path for comparison: leading slash, no duplicate slashes,
 * no trailing slash. Mirrors the normalization in usePageConfig so `/404/`,
 * `404`, and `/404` all compare equal.
 */
export function normalizeNotFoundPath(value) {
  if (!value || typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed) return '/';
  let normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  normalized = normalized.replace(/\/+/g, '/');
  normalized = normalized.replace(/\/+$/, '');
  return normalized || '/';
}

/**
 * True when a page is the not-found page — either by its reserved id or by
 * being routed at /404. Either alone is enough: a site may name the file
 * something else but point it at /404, or vice versa.
 *
 * @param {string} [id] page id (the content filename without extension)
 * @param {string} [path] the page's `path` value
 */
export function isNotFoundPage(id, path) {
  if (id === NOT_FOUND_PAGE_ID) return true;
  return normalizeNotFoundPath(path) === NOT_FOUND_PATH;
}
