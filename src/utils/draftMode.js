/**
 * Pure helpers for "draft mode" — letting authors mark a whole site, a URL
 * prefix, or a single page as not-yet-public so search engines and casual
 * visitors stay out while content is being iterated on.
 *
 * Used by:
 *   - vite-plugin.js: emit Disallow lines in robots.txt, skip URLs in sitemap.xml
 *   - usePageMeta.js: inject <meta name="robots" content="noindex,nofollow">
 *   - useDraftGate.js: decide whether to render the password gate instead of
 *     the page contents
 *
 * Resolution rule (page wins both ways, then site, then prefixes):
 *   1. pageData.draft === true  → draft
 *   2. pageData.draft === false → published (overrides site/prefix)
 *   3. site.draft === true      → draft
 *   4. any draftPaths prefix matches → draft
 *   5. otherwise                → published
 *
 * Prefix match is path-segment-aware: "/blog" matches "/blog" and
 * "/blog/2026/post" but NOT "/blog-archive". The literal prefix "/" matches
 * only "/" itself; for whole-site draft, set site.draft = true instead.
 */

export function normalizeDraftPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let p = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  p = p.replace(/\/+/g, '/').replace(/\/+$/, '');
  return p || '/';
}

export function pathMatchesPrefix(prefix, path) {
  const np = normalizeDraftPath(prefix);
  const target = normalizeDraftPath(path);
  if (!np || !target) return false;
  if (np === target) return true;
  if (np === '/') return false;
  return target.startsWith(`${np}/`);
}

export function isPathDraft(siteData, pagePath, pageData) {
  if (pageData && typeof pageData === 'object') {
    if (pageData.draft === true) return true;
    if (pageData.draft === false) return false;
  }

  const site = siteData?.site;
  if (!site || typeof site !== 'object') return false;

  if (site.draft === true) return true;

  const draftPaths = Array.isArray(site.draftPaths) ? site.draftPaths : [];
  for (const prefix of draftPaths) {
    if (pathMatchesPrefix(prefix, pagePath)) return true;
  }

  return false;
}

export function getDraftPasswordHash(siteData) {
  const raw = siteData?.site?.draftPasswordHash;
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}
