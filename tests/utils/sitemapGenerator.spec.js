import { describe, it, expect } from 'vitest';
import { buildSitemap, getSitemapUrl } from '../../src/utils/sitemapGenerator.js';

function siteConfig({ url = 'https://example.com', pages = {}, site = {} } = {}) {
  return { site: { url, ...site }, pages };
}

describe('buildSitemap', () => {
  it('returns "" when site.url is missing', () => {
    expect(buildSitemap({ site: {}, pages: { home: { path: '/' } } })).toBe('');
    expect(buildSitemap({ site: { url: '' }, pages: { home: { path: '/' } } })).toBe('');
    expect(buildSitemap(null)).toBe('');
  });

  it('returns "" when there are no published pages', () => {
    expect(buildSitemap(siteConfig({ pages: {} }))).toBe('');
  });

  it('emits one <url> per page with absolute URL', () => {
    const xml = buildSitemap(
      siteConfig({
        url: 'https://example.com',
        pages: {
          home: { path: '/' },
          about: { path: '/about' },
        },
      }),
    );
    expect(xml).toContain('<loc>https://example.com/</loc>');
    expect(xml).toContain('<loc>https://example.com/about</loc>');
  });

  it('strips trailing slash from siteUrl', () => {
    const xml = buildSitemap(
      siteConfig({ url: 'https://example.com/', pages: { home: { path: '/' } } }),
    );
    expect(xml).toContain('<loc>https://example.com/</loc>');
    expect(xml).not.toContain('<loc>https://example.com//</loc>');
  });

  it('skips draft pages', () => {
    const xml = buildSitemap(
      siteConfig({
        pages: {
          home: { path: '/' },
          secret: { path: '/secret', draft: true },
        },
      }),
    );
    expect(xml).toContain('/');
    expect(xml).not.toContain('/secret');
  });

  it('skips pages under draftPaths prefixes', () => {
    const xml = buildSitemap(
      siteConfig({
        site: { draftPaths: ['/hidden'] },
        pages: {
          home: { path: '/' },
          about: { path: '/about' },
          h1: { path: '/hidden/foo' },
          h2: { path: '/hidden' },
        },
      }),
    );
    expect(xml).toContain('/about');
    expect(xml).not.toContain('/hidden');
  });

  it('emits no urls when site is fully draft', () => {
    expect(
      buildSitemap(siteConfig({ site: { draft: true }, pages: { home: { path: '/' } } })),
    ).toBe('');
  });

  it('site-wide draft returns "" even with page-level draft:false override', () => {
    const xml = buildSitemap(
      siteConfig({
        site: { draft: true },
        pages: {
          home: { path: '/' },
          welcome: { path: '/welcome', draft: false },
        },
      }),
    );
    expect(xml).toBe('');
  });

  it('emits page-level draft:false override even if path is in draftPaths', () => {
    const xml = buildSitemap(
      siteConfig({
        site: { draftPaths: ['/blog'] },
        pages: {
          welcome: { path: '/blog/welcome', draft: false },
          unfinished: { path: '/blog/wip' },
        },
      }),
    );
    expect(xml).toContain('/blog/welcome');
    expect(xml).not.toContain('/blog/wip');
  });

  it('escapes XML-special characters in URLs', () => {
    const xml = buildSitemap(
      siteConfig({
        url: 'https://example.com',
        pages: { weird: { path: '/q&a' } },
      }),
    );
    expect(xml).toContain('/q&amp;a');
    expect(xml).not.toContain('/q&a<');
  });

  it('produces valid xml structure', () => {
    const xml = buildSitemap(
      siteConfig({ pages: { home: { path: '/' }, about: { path: '/about' } } }),
    );
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('</urlset>');
  });

  it('deduplicates URLs from pages with the same path', () => {
    const xml = buildSitemap(
      siteConfig({
        pages: {
          page1: { path: '/about' },
          page2: { path: '/about/' },
        },
      }),
    );
    const matches = xml.match(/<loc>https:\/\/example\.com\/about<\/loc>/g) || [];
    expect(matches.length).toBe(1);
  });

  describe('multi-locale (hreflang alternates)', () => {
    function multiLocaleArgs(extra = {}) {
      return [
        siteConfig({
          url: 'https://example.com',
          pages: { home: { path: '/' }, about: { path: '/about' } },
          ...extra,
        }),
        { availableLocales: ['en', 'de', 'fr'], baseLocale: 'en' },
      ];
    }

    it('declares xmlns:xhtml on <urlset> for multi-locale', () => {
      const xml = buildSitemap(...multiLocaleArgs());
      expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    });

    it('does NOT declare xmlns:xhtml for single-locale', () => {
      const xml = buildSitemap(
        siteConfig({ pages: { about: { path: '/about' } } }),
        { availableLocales: ['en'], baseLocale: 'en' },
      );
      expect(xml).not.toContain('xmlns:xhtml');
    });

    it('emits one xhtml:link per available locale + x-default per page', () => {
      const xml = buildSitemap(...multiLocaleArgs());
      const aboutBlock = xml.split('<url>').find((b) => b.includes('/about<'));
      expect(aboutBlock).toBeDefined();
      expect(aboutBlock).toContain('hreflang="en" href="https://example.com/about"');
      expect(aboutBlock).toContain('hreflang="de" href="https://example.com/de/about"');
      expect(aboutBlock).toContain('hreflang="fr" href="https://example.com/fr/about"');
      expect(aboutBlock).toContain('hreflang="x-default" href="https://example.com/about"');
    });

    it('uses base-locale URL as <loc>', () => {
      const xml = buildSitemap(...multiLocaleArgs());
      expect(xml).toContain('<loc>https://example.com/about</loc>');
      expect(xml).not.toContain('<loc>https://example.com/de/about</loc>');
    });

    it('drafts still excluded in multi-locale output', () => {
      const xml = buildSitemap(
        siteConfig({
          pages: {
            about: { path: '/about' },
            secret: { path: '/secret', draft: true },
          },
        }),
        { availableLocales: ['en', 'de'], baseLocale: 'en' },
      );
      expect(xml).toContain('/about');
      expect(xml).not.toContain('/secret');
    });

    it('home page (path "/") emits root URLs across locales', () => {
      const xml = buildSitemap(
        siteConfig({ pages: { home: { path: '/' } } }),
        { availableLocales: ['en', 'de'], baseLocale: 'en' },
      );
      expect(xml).toContain('<loc>https://example.com/</loc>');
      expect(xml).toContain('hreflang="de" href="https://example.com/de"');
      expect(xml).toContain('hreflang="en" href="https://example.com/"');
    });

    it('non-base options still produce single-locale output (boundary)', () => {
      // Only one locale total (base) → behaves as single-locale
      const xml = buildSitemap(
        siteConfig({ pages: { about: { path: '/about' } } }),
        { availableLocales: ['en'], baseLocale: 'en' },
      );
      expect(xml).not.toContain('xhtml:link');
      expect(xml).toContain('<url><loc>https://example.com/about</loc></url>');
    });
  });
});

describe('getSitemapUrl', () => {
  it('returns the absolute sitemap URL', () => {
    expect(getSitemapUrl({ site: { url: 'https://example.com' } })).toBe(
      'https://example.com/sitemap.xml',
    );
  });

  it('strips trailing slashes', () => {
    expect(getSitemapUrl({ site: { url: 'https://example.com/' } })).toBe(
      'https://example.com/sitemap.xml',
    );
  });

  it('returns "" when site.url is missing', () => {
    expect(getSitemapUrl({ site: {} })).toBe('');
    expect(getSitemapUrl(null)).toBe('');
  });
});
