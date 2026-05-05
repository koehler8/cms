import { describe, it, expect } from 'vitest';
import { buildRobotsTxt } from '../../src/utils/robotsGenerator.js';

describe('buildRobotsTxt', () => {
  it('always emits framework defaults', () => {
    const out = buildRobotsTxt({ site: {}, pages: {} });
    expect(out).toContain('User-agent: *');
    expect(out).toContain('Disallow: /admin');
    expect(out).toContain('Disallow: /privacy');
    expect(out).toContain('Disallow: /terms');
    expect(out).toContain('Disallow: /cookies');
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
    // First 4 are framework defaults, then sorted: /apple, /middle, /zoo
    expect(tail.slice(4)).toEqual(['Disallow: /apple', 'Disallow: /middle', 'Disallow: /zoo']);
  });
});
