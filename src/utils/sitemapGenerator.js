/**
 * Build sitemap.xml from the inflated site config.
 *
 * Pages where isPathDraft() is true are skipped — drafts must not be in the
 * sitemap. Returns '' when site.url is missing (the sitemap protocol requires
 * absolute URLs); the plugin treats empty output as "do not write the file."
 *
 * v1 emits only <loc> per page. No <lastmod>, <changefreq>, <priority>, or
 * hreflang alternates yet — a page with a path is listed once with its
 * unprefixed canonical URL. Multi-locale sites can layer hreflang in later.
 */

import { isPathDraft, normalizeDraftPath } from './draftMode.js';

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

export function buildSitemap(siteConfig) {
  const siteUrl = (siteConfig?.site?.url || '').trim().replace(/\/+$/, '');
  if (!siteUrl) return '';

  // Whole-site draft → no sitemap. robots.txt emits "Disallow: /" in this
  // state, and listing URLs in the sitemap that the same robots blocks
  // would be inconsistent (and would cause crawl-error noise in Search
  // Console). Page-level draft:false in a fully-draft site only affects
  // the runtime gate; it is not advertised to crawlers.
  if (siteConfig?.site?.draft === true) return '';

  const pages = siteConfig?.pages || {};
  const urls = new Set();

  for (const [, pageData] of Object.entries(pages)) {
    if (!pageData || typeof pageData !== 'object') continue;
    const path = normalizeDraftPath(pageData.path) || '/';
    if (isPathDraft(siteConfig, path, pageData)) continue;
    const url = path === '/' ? `${siteUrl}/` : `${siteUrl}${path}`;
    urls.add(url);
  }

  if (urls.size === 0) return '';

  const sortedUrls = Array.from(urls).sort();
  const urlEntries = sortedUrls
    .map((loc) => `  <url><loc>${escapeXml(loc)}</loc></url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`;
}

export function getSitemapUrl(siteConfig) {
  const siteUrl = (siteConfig?.site?.url || '').trim().replace(/\/+$/, '');
  if (!siteUrl) return '';
  return `${siteUrl}/sitemap.xml`;
}
