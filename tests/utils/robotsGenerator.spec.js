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
    expect(out).toContain('Disallow: /admin');
    expect(out).toContain('Disallow: /');
  });

  it('emits Disallow lines for each draftPaths entry', () => {
    const out = buildRobotsTxt({
      site: { draftPaths: ['/hidden', '/blog/2026'] },
      pages: {},
    });
    expect(out).toContain('Disallow: /hidden');
    expect(out).toContain('Disallow: /blog/2026');
  });

  it('emits Disallow lines for each draft page', () => {
    const out = buildRobotsTxt({
      site: {},
      pages: {
        home: { path: '/' },
        secret: { path: '/secret', draft: true },
        wip: { path: '/projects/wip', draft: true },
      },
    });
    expect(out).toContain('Disallow: /secret');
    expect(out).toContain('Disallow: /projects/wip');
    expect(out).not.toContain('Disallow: /\nDisallow:');
  });

  it('does not duplicate framework defaults that appear in draftPaths', () => {
    const out = buildRobotsTxt({
      site: { draftPaths: ['/admin', '/privacy'] },
      pages: {},
    });
    const adminMatches = out.match(/Disallow: \/admin/g) || [];
    expect(adminMatches.length).toBe(1);
  });

  it('omits per-path lines when site is fully draft', () => {
    const out = buildRobotsTxt({
      site: { draft: true, draftPaths: ['/blog'] },
      pages: { secret: { path: '/secret', draft: true } },
    });
    expect(out).toContain('Disallow: /');
    // /blog should not appear since the wildcard already covers it
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

  it('normalizes paths in draftPaths', () => {
    const out = buildRobotsTxt({
      site: { draftPaths: ['hidden/', '//double/'] },
      pages: {},
    });
    expect(out).toContain('Disallow: /hidden');
    expect(out).toContain('Disallow: /double');
  });

  it('sorts additional disallows alphabetically', () => {
    const out = buildRobotsTxt({
      site: { draftPaths: ['/zoo', '/apple'] },
      pages: {
        m: { path: '/middle', draft: true },
      },
    });
    const tail = out.split('\n').filter((l) => l.startsWith('Disallow:'));
    // First line is the /admin framework default, then sorted: /apple, /middle, /zoo
    expect(tail.slice(1)).toEqual(['Disallow: /apple', 'Disallow: /middle', 'Disallow: /zoo']);
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

    // Draft page is gated (in robots), never advertised (not in sitemap).
    expect(sitemapPaths).not.toContain('/secret');
    expect(disallows).toContain('/secret');
  });
});
