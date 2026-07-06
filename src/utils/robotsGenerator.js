/**
 * Build robots.txt body from the inflated site config.
 *
 * Replaces the static cms/public/robots.txt — the plugin writes this string
 * to siteRoot/public/robots.txt at config time so per-site draft state
 * (site.draft, site.draftPaths, page.draft) regenerates the disallow list on
 * every build.
 *
 * Always disallows /admin (a non-public route that is never listed in the
 * sitemap). Compliance pages (/privacy, /terms, /cookies) are intentionally
 * NOT disallowed: they are public, footer-linked, emit correct canonicals, and
 * appear in sitemap.xml — disallowing them contradicts the sitemap and triggers
 * "Blocked by robots.txt" (pages-in-a-sitemap) errors in Search Console. Adds:
 *   - "Disallow: /" when site.draft === true
 *   - "Disallow: <prefix>" for each entry in site.draftPaths
 *   - "Disallow: <path>" for each page with draft === true
 *
 * site.robots.allowAiCrawlers (opt-in, default off): appends a dedicated block
 * per known AI/LLM crawler (GPTBot, ClaudeBot, PerplexityBot, CCBot, etc.),
 * each carrying the exact same Disallow list as the wildcard block — i.e.
 * identical effective access, just declared explicitly per bot. Several sites
 * were hand-editing this list directly into public/robots.txt; since that file
 * is regenerated on every build, the hand edits were silently reverted on the
 * next `build:ssg`/`generate:public-assets` run. This option makes the
 * customization durable. Skipped entirely when site.draft === true — a
 * pre-launch site shouldn't explicitly invite crawlers.
 *
 * If sitemapUrl is provided, appends a "Sitemap: <url>" line.
 */

import { normalizeDraftPath } from './draftMode.js';

const FRAMEWORK_DEFAULTS = ['/admin'];

// Order/grouping mirrors the hand-rolled lists sites had converged on before
// this became a config option.
const AI_CRAWLER_GROUPS = [
  { comment: 'OpenAI / ChatGPT', agents: ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User'] },
  { comment: 'Anthropic / Claude', agents: ['anthropic-ai', 'ClaudeBot'] },
  { comment: 'Perplexity', agents: ['PerplexityBot'] },
  { comment: 'Common Crawl (used by many LLM training datasets)', agents: ['CCBot'] },
  { comment: 'Google', agents: ['Googlebot', 'Googlebot-Extended'] },
  { comment: 'Microsoft / Bing', agents: ['Bingbot'] },
  { comment: 'Meta', agents: ['FacebookBot'] },
  { comment: 'Diffbot', agents: ['Diffbot'] },
];

export function buildRobotsTxt(siteConfig, sitemapUrl = '') {
  const site = siteConfig?.site || {};
  const pages = siteConfig?.pages || {};

  const disallows = [...FRAMEWORK_DEFAULTS];

  if (site.draft === true) {
    disallows.push('/');
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
      disallows.push(p);
    }
  }

  const lines = ['User-agent: *'];
  for (const d of disallows) {
    lines.push(`Disallow: ${d}`);
  }

  if (site.robots?.allowAiCrawlers === true && site.draft !== true) {
    for (const group of AI_CRAWLER_GROUPS) {
      lines.push('');
      lines.push(`# ${group.comment}`);
      for (const agent of group.agents) {
        lines.push(`User-agent: ${agent}`);
        for (const d of disallows) {
          lines.push(`Disallow: ${d}`);
        }
      }
    }
  }

  const trimmedSitemap = (sitemapUrl || '').trim();
  if (trimmedSitemap) {
    lines.push('');
    lines.push(`Sitemap: ${trimmedSitemap}`);
  }

  return `${lines.join('\n')}\n`;
}
