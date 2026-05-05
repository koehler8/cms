/**
 * Build robots.txt body from the inflated site config.
 *
 * Replaces the static cms/public/robots.txt — the plugin writes this string
 * to siteRoot/public/robots.txt at config time so per-site draft state
 * (site.draft, site.draftPaths, page.draft) regenerates the disallow list on
 * every build.
 *
 * Always includes the framework-default disallows (/admin, /privacy, /terms,
 * /cookies — these routes exist on every CMS site). Adds:
 *   - "Disallow: /" when site.draft === true
 *   - "Disallow: <prefix>" for each entry in site.draftPaths
 *   - "Disallow: <path>" for each page with draft === true
 *
 * If sitemapUrl is provided, appends a "Sitemap: <url>" line.
 */

import { normalizeDraftPath } from './draftMode.js';

const FRAMEWORK_DEFAULTS = ['/admin', '/privacy', '/terms', '/cookies'];

export function buildRobotsTxt(siteConfig, sitemapUrl = '') {
  const lines = ['User-agent: *'];

  for (const p of FRAMEWORK_DEFAULTS) {
    lines.push(`Disallow: ${p}`);
  }

  const site = siteConfig?.site || {};
  const pages = siteConfig?.pages || {};

  if (site.draft === true) {
    lines.push('Disallow: /');
  } else {
    const additional = new Set();

    const draftPaths = Array.isArray(site.draftPaths) ? site.draftPaths : [];
    for (const p of draftPaths) {
      const np = normalizeDraftPath(p);
      if (np && !FRAMEWORK_DEFAULTS.includes(np)) additional.add(np);
    }

    for (const [, pageData] of Object.entries(pages)) {
      if (!pageData || typeof pageData !== 'object') continue;
      if (pageData.draft !== true) continue;
      const np = normalizeDraftPath(pageData.path);
      if (np && !FRAMEWORK_DEFAULTS.includes(np)) additional.add(np);
    }

    for (const p of Array.from(additional).sort()) {
      lines.push(`Disallow: ${p}`);
    }
  }

  const trimmedSitemap = (sitemapUrl || '').trim();
  if (trimmedSitemap) {
    lines.push('');
    lines.push(`Sitemap: ${trimmedSitemap}`);
  }

  return `${lines.join('\n')}\n`;
}
