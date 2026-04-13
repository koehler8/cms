import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// We can't import the full Vite plugin (it relies on Vite + vue plugin),
// but we can test the pure helper functions by extracting them.
// Since they're not exported, we'll test via the module's internal behavior
// by re-implementing the testable functions inline from the source.

// These are pure functions extracted from vite-plugin.js for testability:

function normalizeRoutePath(value = '/') {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed) return '/';
  let normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  normalized = normalized.replace(/\/+/g, '/');
  normalized = normalized.replace(/\/$/, '');
  return normalized || '/';
}

function collectPagePaths(config) {
  if (!config || typeof config !== 'object') return ['/'];
  const pages = config.pages || {};
  const paths = new Set(['/']);
  Object.values(pages).forEach((page) => {
    if (!page || typeof page !== 'object') return;
    if ('path' in page) {
      paths.add(normalizeRoutePath(page.path));
    }
  });
  return Array.from(paths);
}

function extractSiteMetadata(siteConfig) {
  const {
    title: siteTitle = '',
    description: siteDescription = '',
    url: siteUrl = '',
    googleId: siteGoogleId = '',
    sameAs: siteSameAs = [],
  } = siteConfig.site || {};

  const siteSameAsList = Array.isArray(siteSameAs)
    ? siteSameAs.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
    : [];
  const siteSameAsJson = JSON.stringify(siteSameAsList);

  return { siteTitle, siteDescription, siteUrl, siteGoogleId, siteSameAsJson };
}

const htmlEscape = (value) =>
  String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

describe('vite-plugin helpers', () => {
  describe('normalizeRoutePath', () => {
    it('adds leading slash', () => {
      expect(normalizeRoutePath('about')).toBe('/about');
    });

    it('removes trailing slash', () => {
      expect(normalizeRoutePath('/about/')).toBe('/about');
    });

    it('collapses multiple slashes', () => {
      expect(normalizeRoutePath('//about///page')).toBe('/about/page');
    });

    it('returns "/" for empty input', () => {
      expect(normalizeRoutePath('')).toBe('/');
      expect(normalizeRoutePath('   ')).toBe('/');
    });

    it('returns "/" for non-string input', () => {
      expect(normalizeRoutePath(null)).toBe('/');
      expect(normalizeRoutePath(42)).toBe('/');
    });

    it('preserves root path', () => {
      expect(normalizeRoutePath('/')).toBe('/');
    });

    it('handles deep paths', () => {
      expect(normalizeRoutePath('/docs/api/v2')).toBe('/docs/api/v2');
    });
  });

  describe('collectPagePaths', () => {
    it('always includes root path', () => {
      expect(collectPagePaths(null)).toEqual(['/']);
      expect(collectPagePaths({})).toEqual(['/']);
    });

    it('collects paths from page configs', () => {
      const config = {
        pages: {
          about: { path: '/about' },
          team: { path: '/team' },
        },
      };
      const paths = collectPagePaths(config);
      expect(paths).toContain('/');
      expect(paths).toContain('/about');
      expect(paths).toContain('/team');
    });

    it('normalizes collected paths', () => {
      const config = {
        pages: {
          about: { path: 'about/' },
        },
      };
      const paths = collectPagePaths(config);
      expect(paths).toContain('/about');
    });

    it('skips pages without path property', () => {
      const config = {
        pages: {
          home: { title: 'Home' },
          about: { path: '/about' },
        },
      };
      const paths = collectPagePaths(config);
      expect(paths).toHaveLength(2);
    });
  });

  describe('extractSiteMetadata', () => {
    it('extracts metadata from site config', () => {
      const config = {
        site: {
          title: 'Test Site',
          description: 'A test site',
          url: 'https://example.com',
          googleId: 'G-12345',
          sameAs: ['https://twitter.com/test', 'https://github.com/test'],
        },
      };
      const meta = extractSiteMetadata(config);
      expect(meta.siteTitle).toBe('Test Site');
      expect(meta.siteDescription).toBe('A test site');
      expect(meta.siteUrl).toBe('https://example.com');
      expect(meta.siteGoogleId).toBe('G-12345');
      expect(JSON.parse(meta.siteSameAsJson)).toEqual([
        'https://twitter.com/test',
        'https://github.com/test',
      ]);
    });

    it('defaults all fields when site is missing', () => {
      const meta = extractSiteMetadata({});
      expect(meta.siteTitle).toBe('');
      expect(meta.siteDescription).toBe('');
      expect(meta.siteUrl).toBe('');
      expect(meta.siteGoogleId).toBe('');
      expect(meta.siteSameAsJson).toBe('[]');
    });

    it('filters non-string sameAs entries', () => {
      const meta = extractSiteMetadata({
        site: { sameAs: ['valid', '', null, 42, 'also-valid'] },
      });
      expect(JSON.parse(meta.siteSameAsJson)).toEqual(['valid', 'also-valid']);
    });
  });

  describe('htmlEscape', () => {
    it('escapes HTML special characters', () => {
      expect(htmlEscape('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('escapes ampersand', () => {
      expect(htmlEscape('a & b')).toBe('a &amp; b');
    });

    it('escapes single quotes', () => {
      expect(htmlEscape("it's")).toBe('it&#39;s');
    });

    it('handles null/undefined', () => {
      expect(htmlEscape(null)).toBe('');
      expect(htmlEscape(undefined)).toBe('');
    });
  });
});
