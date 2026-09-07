import { describe, it, expect } from 'vitest';
import { buildSitemap, getSitemapUrl, normalizeLastmod } from '../../src/utils/sitemapGenerator.js';

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

    it('emits every locale version as its own <url> entry (Google multilingual-sitemap guidance)', () => {
      const xml = buildSitemap(...multiLocaleArgs());
      expect(xml).toContain('<loc>https://example.com/about</loc>');
      expect(xml).toContain('<loc>https://example.com/de/about</loc>');
      expect(xml).toContain('<loc>https://example.com/fr/about</loc>');
      // Each localized entry carries the identical full alternate cluster.
      const deBlock = xml.split('<url>').find((b) => b.includes('<loc>https://example.com/de/about</loc>'));
      expect(deBlock).toContain('hreflang="en" href="https://example.com/about"');
      expect(deBlock).toContain('hreflang="x-default" href="https://example.com/about"');
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

  describe('trailingSlash', () => {
    it('appends a trailing slash to non-root <loc> when site.trailingSlash is true', () => {
      const xml = buildSitemap(
        siteConfig({
          site: { trailingSlash: true },
          pages: { home: { path: '/' }, about: { path: '/about' }, privacy: { path: '/privacy' } },
        }),
      );
      expect(xml).toContain('<loc>https://example.com/</loc>'); // root unchanged
      expect(xml).toContain('<loc>https://example.com/about/</loc>');
      expect(xml).toContain('<loc>https://example.com/privacy/</loc>');
      expect(xml).not.toContain('<loc>https://example.com/about</loc>');
    });

    it('default (no flag) emits no-slash <loc> (regression)', () => {
      const xml = buildSitemap(siteConfig({ pages: { about: { path: '/about' } } }));
      expect(xml).toContain('<loc>https://example.com/about</loc>');
      expect(xml).not.toContain('<loc>https://example.com/about/</loc>');
    });

    it('applies the slash to multi-locale hreflang alternates too', () => {
      const xml = buildSitemap(
        siteConfig({ site: { trailingSlash: true }, pages: { about: { path: '/about' } } }),
        { availableLocales: ['en', 'de'], baseLocale: 'en' },
      );
      expect(xml).toContain('<loc>https://example.com/about/</loc>');
      expect(xml).toContain('hreflang="de" href="https://example.com/de/about/"');
      expect(xml).toContain('hreflang="en" href="https://example.com/about/"');
    });

    // Locks the alignment: under the flag, every URL the sitemap advertises
    // ends in "/" (except root) — so it matches the slash form the host serves
    // at 200, never the no-slash form that 301-redirects.
    it('every non-root sitemap URL ends in "/" under the flag (consistency invariant)', () => {
      const xml = buildSitemap(
        siteConfig({
          site: { trailingSlash: true },
          pages: {
            home: { path: '/' },
            a: { path: '/malibu' },
            b: { path: '/laguna-beach' },
            c: { path: '/long-beach' },
          },
        }),
      );
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      expect(locs.length).toBe(4);
      for (const loc of locs) {
        if (new URL(loc).pathname === '/') continue;
        expect(loc.endsWith('/'), `${loc} should end with a slash`).toBe(true);
      }
    });
  });
  describe('not-found page', () => {
    // A site-authored pages/404.json is a real pre-rendered route so the plugin
    // can copy it to 404.html. It must never reach the sitemap: it carries
    // noindex, and a noindex URL in a sitemap is a Search Console warning.
    it('excludes a site-authored 404 page', () => {
      const xml = buildSitemap(
        siteConfig({
          pages: {
            home: { path: '/' },
            about: { path: '/about' },
            404: { path: '/404' },
          },
        }),
      );
      expect(xml).toContain('<loc>https://example.com/about</loc>');
      expect(xml).not.toContain('/404');
    });

    it('excludes it when the file is named something other than 404', () => {
      const xml = buildSitemap(
        siteConfig({
          pages: {
            home: { path: '/' },
            'not-found': { path: '/404' },
          },
        }),
      );
      expect(xml).not.toContain('/404');
    });

    it('does not exclude ordinary pages whose path merely contains 404', () => {
      const xml = buildSitemap(
        siteConfig({
          pages: {
            home: { path: '/' },
            report: { path: '/404-report' },
            nested: { path: '/errors/404' },
          },
        }),
      );
      expect(xml).toContain('<loc>https://example.com/404-report</loc>');
      expect(xml).toContain('<loc>https://example.com/errors/404</loc>');
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

describe('lastmod', () => {
  it('emits <lastmod> only for pages that supply meta.lastmod', () => {
    const xml = buildSitemap(
      siteConfig({
        pages: {
          home: { path: '/', meta: { lastmod: '2026-09-06' } },
          about: { path: '/about' },
        },
      }),
    );
    expect(xml).toContain('<loc>https://example.com/</loc>\n    <lastmod>2026-09-06</lastmod>');
    // The page without one is untouched, and no date is invented for it.
    expect(xml).toContain('<url><loc>https://example.com/about</loc></url>');
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
  });

  it('leaves output byte-identical when no page supplies one', () => {
    const pages = { home: { path: '/' }, about: { path: '/about' } };
    expect(buildSitemap(siteConfig({ pages }))).not.toContain('lastmod');
  });

  it('accepts a full ISO 8601 timestamp', () => {
    const xml = buildSitemap(
      siteConfig({ pages: { home: { path: '/', meta: { lastmod: '2026-09-06T14:30:00Z' } } } }),
    );
    expect(xml).toContain('<lastmod>2026-09-06T14:30:00Z</lastmod>');
  });

  it('drops a malformed lastmod rather than emitting invalid XML', () => {
    for (const bad of ['2026', '09/06/2026', 'yesterday', '2026-13-01', '2026-02-30', '', '   ']) {
      const xml = buildSitemap(
        siteConfig({ pages: { home: { path: '/', meta: { lastmod: bad } } } }),
      );
      expect(xml, `expected "${bad}" to be dropped`).not.toContain('<lastmod>');
    }
  });

  it('drops non-string lastmod values', () => {
    for (const bad of [20260906, new Date('2026-09-06'), null, undefined, {}, ['2026-09-06']]) {
      expect(normalizeLastmod(bad)).toBe('');
    }
  });

  it('gives every locale variant of a page the same lastmod', () => {
    const xml = buildSitemap(
      siteConfig({ pages: { about: { path: '/about', meta: { lastmod: '2026-09-06' } } } }),
      { baseLocale: 'en', availableLocales: ['en', 'ja'] },
    );
    expect(xml.match(/<lastmod>2026-09-06<\/lastmod>/g)).toHaveLength(2);
    // Ordering is load-bearing: the sitemap XSD sequences loc then lastmod,
    // with the xhtml:link alternates after both.
    expect(xml).toMatch(/<loc>[^<]+<\/loc>\n\s*<lastmod>[^<]+<\/lastmod>\n\s*<xhtml:link/);
  });

  it('never emits lastmod for a draft or not-found page', () => {
    const xml = buildSitemap(
      siteConfig({
        pages: {
          secret: { path: '/secret', draft: true, meta: { lastmod: '2026-09-06' } },
          404: { path: '/404', meta: { lastmod: '2026-09-06' } },
          home: { path: '/' },
        },
      }),
    );
    expect(xml).not.toContain('<lastmod>');
    expect(xml).not.toContain('/secret');
    expect(xml).not.toContain('/404');
  });
});
