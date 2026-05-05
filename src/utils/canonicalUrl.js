/**
 * Single source of truth for the canonical URL formula.
 *
 * Used by:
 *   - usePageMeta.js (emits <link rel="canonical"> + <link rel="alternate" hreflang>)
 *   - sitemapGenerator.js (emits <loc> + <xhtml:link rel="alternate" hreflang>)
 *
 * URL space rule (matches Google / Stripe / GitHub conventions):
 *   - Base locale → ${siteUrl}${path}     e.g. https://example.com/about
 *   - Non-base    → ${siteUrl}/${locale}${path}   e.g. https://example.com/de/about
 *
 * Returns '' when siteUrl is missing — sitemaps require absolute URLs and
 * canonical links without a host are useless. Callers treat '' as "skip".
 */

function normalizePath(value) {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed) return '/';
  let p = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  p = p.replace(/\/+/g, '/').replace(/\/+$/, '');
  return p || '/';
}

function normalizeLocale(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return trimmed;
}

export function buildCanonicalUrl({ siteUrl, locale, baseLocale, path } = {}) {
  const host = typeof siteUrl === 'string' ? siteUrl.trim().replace(/\/+$/, '') : '';
  if (!host) return '';

  const normalizedPath = normalizePath(path);
  const loc = normalizeLocale(locale);
  const base = normalizeLocale(baseLocale);

  if (!loc || loc === base) {
    return normalizedPath === '/' ? `${host}/` : `${host}${normalizedPath}`;
  }

  return normalizedPath === '/' ? `${host}/${loc}` : `${host}/${loc}${normalizedPath}`;
}
