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

    if (!isMultiLocale) {
      entries.push({ loc: baseUrl, alternates: [] });
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
      if (localizedUrl) entries.push({ loc: localizedUrl, alternates });
    }
  }

  if (entries.length === 0) return '';

  entries.sort((a, b) => a.loc.localeCompare(b.loc));

  const urlsetAttrs = isMultiLocale
    ? 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

  const renderUrlEntry = (entry) => {
    if (entry.alternates.length === 0) {
      return `  <url><loc>${escapeXml(entry.loc)}</loc></url>`;
    }
    const altLines = entry.alternates
      .map((a) => `    <xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(a.href)}"/>`)
      .join('\n');
    return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n${altLines}\n  </url>`;
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
