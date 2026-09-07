/**
 * Build sitemap.xml from the inflated site config.
 *
 * Pages where isPathDraft() is true are skipped — drafts must not be in the
 * sitemap. The not-found page is skipped for the same reason: it is a real
 * pre-rendered route (so the plugin can copy it to 404.html) but it carries
 * noindex, and listing a noindex URL is a Search Console warning.
 * Returns '' when site.url is missing (the sitemap protocol requires
 * absolute URLs); the plugin treats empty output as "do not write the file."
 *
 * Single-locale sites emit only <loc> per page. Multi-locale sites emit one
 * <url> per page × locale — every localized URL is a first-class sitemap
 * entry (Google's multilingual guidance) — each carrying the full
 * <xhtml:link rel="alternate" hreflang="..." /> cluster plus an `x-default`
 * pointing at the base-locale URL. The single-locale output stays
 * byte-identical to pre-hreflang.
 *
 * <lastmod> is emitted for a page only when it supplies `meta.lastmod`, as
 * either a date (YYYY-MM-DD) or a full ISO 8601 timestamp. The framework never
 * derives one: build time is not modification time, and a sitemap whose
 * lastmod moves on every deploy is one search engines learn to ignore
 * (Google's stated rule is that it must be consistently accurate). A page that
 * omits it is emitted exactly as before, so existing sites are unchanged.
 *
 * All locale variants of a page share its lastmod — a translation of a page is
 * the same page, and the site is the only thing that knows otherwise.
 */

import { isPathDraft, normalizeDraftPath } from './draftMode.js';
import { buildCanonicalUrl } from './canonicalUrl.js';
import { isNotFoundPage } from './notFound.js';

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

// W3C Datetime, the subset the sitemap protocol allows: a complete date, or a
// complete date plus hours/minutes/seconds and a timezone. Anything else — a
// bare year, a US-format date, a Date object stringified, a number — is
// dropped rather than emitted, because a malformed lastmod invalidates the
// <url> entry for some parsers and is worse than none at all.
const LASTMOD_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LASTMOD_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function normalizeLastmod(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';
  if (!LASTMOD_DATE.test(raw) && !LASTMOD_DATETIME.test(raw)) return '';
  // Shape-valid but not a real day (2026-02-30, month 13) — Date rolls those
  // over silently, so compare the round-trip rather than trusting the parse.
  const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return '';
  }
  return raw;
}

export function buildSitemap(siteConfig, options = {}) {
  const siteUrl = (siteConfig?.site?.url || '').trim().replace(/\/+$/, '');
  if (!siteUrl) return '';
  const trailingSlash = siteConfig?.site?.trailingSlash === true;

  // Whole-site draft → no sitemap. robots.txt emits "Disallow: /" in this
  // state, and listing URLs in the sitemap that the same robots blocks
  // would be inconsistent (and would cause crawl-error noise in Search
  // Console). Page-level draft:false in a fully-draft site only affects
  // the runtime gate; it is not advertised to crawlers.
  if (siteConfig?.site?.draft === true) return '';

  const baseLocale = typeof options.baseLocale === 'string' ? options.baseLocale.toLowerCase() : '';
  const availableLocales = Array.isArray(options.availableLocales)
    ? options.availableLocales.map((l) => (typeof l === 'string' ? l.toLowerCase() : '')).filter(Boolean)
    : [];
  const isMultiLocale = availableLocales.length > 1;

  const pages = siteConfig?.pages || {};
  const entries = [];
  const seenPaths = new Set();

  for (const [pageId, pageData] of Object.entries(pages)) {
    if (!pageData || typeof pageData !== 'object') continue;
    const pagePath = normalizeDraftPath(pageData.path) || '/';
    if (isPathDraft(siteConfig, pagePath, pageData)) continue;
    // The not-found page is pre-rendered as a real route so the plugin can copy
    // it to 404.html, but it carries noindex and must never be advertised.
    if (isNotFoundPage(pageId, pagePath)) continue;
    if (seenPaths.has(pagePath)) continue;
    seenPaths.add(pagePath);

    const baseUrl = buildCanonicalUrl({ siteUrl, baseLocale, locale: baseLocale, path: pagePath, trailingSlash });
    if (!baseUrl) continue;

    const lastmod = normalizeLastmod(pageData?.meta?.lastmod);

    if (!isMultiLocale) {
      entries.push({ loc: baseUrl, alternates: [], lastmod });
      continue;
    }

    // Every locale version is its own <url> entry; the alternate cluster is
    // identical across them (that's the spec — each entry lists all of its
    // language versions, including itself).
    const alternates = availableLocales.map((loc) => ({
      hreflang: loc,
      href: buildCanonicalUrl({ siteUrl, baseLocale, locale: loc, path: pagePath, trailingSlash }),
    }));
    alternates.push({ hreflang: 'x-default', href: baseUrl });

    for (const loc of availableLocales) {
      const localizedUrl = buildCanonicalUrl({ siteUrl, baseLocale, locale: loc, path: pagePath, trailingSlash });
      if (localizedUrl) entries.push({ loc: localizedUrl, alternates, lastmod });
    }
  }

  if (entries.length === 0) return '';

  entries.sort((a, b) => a.loc.localeCompare(b.loc));

  const urlsetAttrs = isMultiLocale
    ? 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

  const renderUrlEntry = (entry) => {
    // <lastmod> follows <loc> and precedes the alternates: the sitemap XSD
    // sequences loc, lastmod, changefreq, priority, and xhtml:link extensions
    // are appended after those.
    const lastmodLine = entry.lastmod
      ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`
      : '';

    if (entry.alternates.length === 0) {
      // Kept on one line when there is nothing else to emit, so single-locale
      // sites with no lastmod stay byte-identical to previous versions.
      return entry.lastmod
        ? `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmodLine}\n  </url>`
        : `  <url><loc>${escapeXml(entry.loc)}</loc></url>`;
    }
    const altLines = entry.alternates
      .map((a) => `    <xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(a.href)}"/>`)
      .join('\n');
    return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmodLine}\n${altLines}\n  </url>`;
  };

  const urlEntries = entries.map(renderUrlEntry).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset ${urlsetAttrs}>
${urlEntries}
</urlset>
`;
}

export function getSitemapUrl(siteConfig) {
  const siteUrl = (siteConfig?.site?.url || '').trim().replace(/\/+$/, '');
  if (!siteUrl) return '';
  return `${siteUrl}/sitemap.xml`;
}
