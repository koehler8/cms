import { describe, it, expect } from 'vitest';
import { buildRobotsTxt } from '../../src/utils/robotsGenerator.js';
import { buildSitemap, getSitemapUrl } from '../../src/utils/sitemapGenerator.js';

describe('buildRobotsTxt', () => {
  it('emits only /admin as a framework default (compliance pages stay crawlable)', () => {
    const out = buildRobotsTxt({ site: {}, pages: {} });
    expect(out).toContain('User-agent: *');
    expect(out).toContain('Disallow: /admin');
    // Compliance pages are public, sitemap-listed, and must NOT be blocked —
    // disallowing them contradicts the sitemap (Search Console "Blocked by
    // robots.txt"). See robots/sitemap consistency invariant below.
    expect(out).not.toContain('Disallow: /privacy');
    expect(out).not.toContain('Disallow: /terms');
    expect(out).not.toContain('Disallow: /cookies');
  });

  it('emits a single Disallow: / for site-wide draft', () => {
    const out = buildRobotsTxt({ site: { draft: true }, pages: {} });
    expect(out).toContain('Disallow: /');
  });

  // Draft URLs are deliberately kept OUT of robots.txt: the file is public, so
  // a Disallow line is itself the discovery vector for an otherwise-unlinked
  // draft URL — and a disallowed URL can't be crawled, so Google never sees
  // the page's noindex meta ("Indexed, though blocked by robots.txt").
  // Deindexing is handled by the noindex meta + sitemap omission + the gate.
  it('does not disclose draftPaths prefixes', () => {
    const out = buildRobotsTxt({
      site: { draftPaths: ['/hidden', '/blog/2026'] },
      pages: {},
    });
    expect(out).not.toContain('/hidden');
    expect(out).not.toContain('/blog/2026');
  });

  it('does not disclose per-page drafts', () => {
    const out = buildRobotsTxt({
      site: {},
      pages: {
        home: { path: '/' },
        secret: { path: '/secret', draft: true },
        wip: { path: '/projects/wip', draft: true },
      },
    });
    expect(out).not.toContain('/secret');
    expect(out).not.toContain('/projects/wip');
  });

  it('site-wide draft stays a blanket block with no per-path lines', () => {
    const out = buildRobotsTxt({
      site: { draft: true, draftPaths: ['/blog'] },
      pages: { secret: { path: '/secret', draft: true } },
    });
    expect(out).toContain('Disallow: /');
    expect(out).not.toContain('Disallow: /blog');
    expect(out).not.toContain('Disallow: /secret');
  });

  it('appends Sitemap line when sitemapUrl is provided', () => {
    const out = buildRobotsTxt({ site: {}, pages: {} }, 'https://example.com/sitemap.xml');
    expect(out).toContain('Sitemap: https://example.com/sitemap.xml');
  });

  it('omits Sitemap line when no sitemapUrl', () => {
    const out = buildRobotsTxt({ site: {}, pages: {} }, '');
    expect(out).not.toContain('Sitemap:');
  });

  it('output ends with newline', () => {
    const out = buildRobotsTxt({ site: {}, pages: {} });
    expect(out.endsWith('\n')).toBe(true);
  });

  describe('site.robots.allowAiCrawlers', () => {
    it('is off by default — no named crawler blocks appear', () => {
      const out = buildRobotsTxt({ site: {}, pages: {} });
      expect(out).not.toContain('GPTBot');
      expect(out).not.toContain('User-agent: ClaudeBot');
    });

    it('emits a dedicated block per known AI/LLM crawler when enabled', () => {
      const out = buildRobotsTxt({ site: { robots: { allowAiCrawlers: true } }, pages: {} });
      for (const agent of [
        'GPTBot',
        'OAI-SearchBot',
        'ChatGPT-User',
        'anthropic-ai',
        'ClaudeBot',
        'PerplexityBot',
        'CCBot',
        'Googlebot',
        'Googlebot-Extended',
        'Bingbot',
        'FacebookBot',
        'Diffbot',
      ]) {
        expect(out).toContain(`User-agent: ${agent}`);
      }
    });

    it('gives each named crawler the same Disallow list as the wildcard block — and no draft paths', () => {
      const out = buildRobotsTxt({
        site: { robots: { allowAiCrawlers: true }, draftPaths: ['/hidden'] },
        pages: { secret: { path: '/secret', draft: true } },
      });
      const blocks = out.split(/\n\n+/);
      const claudeBlock = blocks.find((b) => b.includes('User-agent: ClaudeBot'));
      expect(claudeBlock).toContain('Disallow: /admin');
      expect(out).not.toContain('/hidden');
      expect(out).not.toContain('/secret');
    });

    it('is skipped entirely when the whole site is in draft', () => {
      const out = buildRobotsTxt({ site: { draft: true, robots: { allowAiCrawlers: true } }, pages: {} });
      expect(out).not.toContain('GPTBot');
      expect(out).toContain('Disallow: /');
    });

    it('defaults to off when site.robots is absent', () => {
      const out = buildRobotsTxt({ site: {}, pages: {} });
      expect(out).not.toContain('User-agent: GPTBot');
    });
  });

  // Regression guard for the 2026-06-09 fleet-wide Search Console event: the
  // framework was disallowing /privacy, /terms, /cookies while sitemap.xml
  // listed those same pages — every site told Google "index these" and "don't
  // crawl these" at once. This invariant makes that contradiction impossible to
  // reintroduce: no URL advertised in the sitemap may be blocked by robots.txt
  // generated from the same config (robots Disallow is prefix-match).
  it('never disallows a URL that appears in the sitemap', () => {
    const config = {
      site: { url: 'https://example.com' },
      pages: {
        home: { path: '/' },
        privacy: { path: '/privacy' },
        terms: { path: '/terms' },
        cookies: { path: '/cookies' },
        secret: { path: '/secret', draft: true },
      },
    };
    const robots = buildRobotsTxt(config, getSitemapUrl(config));
    const sitemap = buildSitemap(config);

    const disallows = robots
      .split('\n')
      .filter((l) => l.startsWith('Disallow: '))
      .map((l) => l.slice('Disallow: '.length).trim())
      .filter(Boolean);
    const sitemapPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => new URL(m[1]).pathname,
    );

    // The compliance pages must actually be in the sitemap (guards against the
    // test passing vacuously if sitemap generation changes).
    expect(sitemapPaths).toContain('/privacy');
    for (const path of sitemapPaths) {
      for (const dis of disallows) {
        expect(
          path.startsWith(dis),
          `sitemap URL ${path} is blocked by "Disallow: ${dis}"`,
        ).toBe(false);
      }
    }

    // Draft page: never advertised (not in sitemap), never disclosed (not in
    // robots.txt at all — deindexing is noindex meta + gate, not Disallow).
    expect(sitemapPaths).not.toContain('/secret');
    expect(robots).not.toContain('/secret');
  });
});
