/**
 * Build robots.txt body from the inflated site config.
 *
 * Replaces the static cms/public/robots.txt — the plugin writes this string
 * to siteRoot/public/robots.txt at config time so per-site draft state
 * regenerates the policy on every build.
 *
 * Compliance pages (/privacy, /terms, /cookies) are intentionally NOT
 * disallowed: they are public, footer-linked, emit correct canonicals, and
 * appear in sitemap.xml — disallowing them contradicts the sitemap and triggers
 * "Blocked by robots.txt" (pages-in-a-sitemap) errors in Search Console.
 *
 * Draft pages and site.draftPaths prefixes are deliberately NOT disallowed
 * here. robots.txt is public, so a per-path Disallow line is itself the
 * discovery vector for an otherwise-unlinked draft URL — and a disallowed URL
 * cannot be crawled, so Google never sees the page's noindex meta and can
 * still index it URL-only from an external link ("Indexed, though blocked by
 * robots.txt"). Draft privacy is enforced where it actually works: the
 * password gate (SSG HTML on disk contains only the gate), the per-page
 * <meta name="robots" content="noindex, nofollow"> from usePageMeta, and
 * omission from sitemap.xml. Only the site-wide draft state emits a blanket
 * "Disallow: /" — a pre-launch site has no individual URLs to disclose.
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
 *
 * site.robots.extraSitemaps (opt-in, default none): appends one additional
 * "Sitemap:" line per entry, after the primary. Google and Bing both accept an
 * RSS/Atom feed as a sitemap format, so a publication with a nightly-updating
 * feed can advertise it as a discovery surface alongside sitemap.xml. This has
 * to be a config option for the same reason allowAiCrawlers does: public/
 * robots.txt is regenerated on every build, so hand edits are silently
 * reverted on the next build:ssg. Entries are de-duplicated against each other
 * and against the primary sitemap, trimmed, and — like allowAiCrawlers —
 * skipped entirely when site.draft === true, since a pre-launch site should not
 * be advertising discovery surfaces at all.
 */

// No framework-default disallows: every framework route is either public
// (pages, locales) or non-indexable by construction (/404 emits noindex).
const FRAMEWORK_DEFAULTS = [];

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

  const disallows = [...FRAMEWORK_DEFAULTS];

  if (site.draft === true) {
    disallows.push('/');
  }

  const lines = ['User-agent: *'];
  if (disallows.length === 0) {
    // A UA record needs a Disallow field; the empty value means "allow all".
    lines.push('Disallow:');
  }
  for (const d of disallows) {
    lines.push(`Disallow: ${d}`);
  }

  if (site.robots?.allowAiCrawlers === true && site.draft !== true) {
    for (const group of AI_CRAWLER_GROUPS) {
      lines.push('');
      lines.push(`# ${group.comment}`);
      for (const agent of group.agents) {
        lines.push(`User-agent: ${agent}`);
        if (disallows.length === 0) {
          lines.push('Disallow:');
        }
        for (const d of disallows) {
          lines.push(`Disallow: ${d}`);
        }
      }
    }
  }

  const trimmedSitemap = (sitemapUrl || '').trim();
  const sitemaps = [];
  if (trimmedSitemap) sitemaps.push(trimmedSitemap);

  if (site.draft !== true) {
    const extras = Array.isArray(site.robots?.extraSitemaps) ? site.robots.extraSitemaps : [];
    for (const entry of extras) {
      if (typeof entry !== 'string') continue;
      const url = entry.trim();
      // A duplicate line is not an error to a crawler, but it reads as a
      // config bug to anyone opening the file.
      if (url && !sitemaps.includes(url)) sitemaps.push(url);
    }
  }

  if (sitemaps.length) {
    lines.push('');
    for (const url of sitemaps) lines.push(`Sitemap: ${url}`);
  }

  return `${lines.join('\n')}\n`;
}
