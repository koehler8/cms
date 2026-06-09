import { describe, it, expect } from 'vitest';
import { buildCanonicalUrl } from '../../src/utils/canonicalUrl.js';

describe('buildCanonicalUrl', () => {
  it('returns empty string when siteUrl is missing', () => {
    expect(buildCanonicalUrl({ path: '/about' })).toBe('');
    expect(buildCanonicalUrl({ siteUrl: '', path: '/about' })).toBe('');
    expect(buildCanonicalUrl({ siteUrl: '   ', path: '/about' })).toBe('');
    expect(buildCanonicalUrl({ siteUrl: null, path: '/about' })).toBe('');
  });

  it('strips trailing slash from siteUrl', () => {
    expect(
      buildCanonicalUrl({ siteUrl: 'https://example.com/', path: '/about' }),
    ).toBe('https://example.com/about');
    expect(
      buildCanonicalUrl({ siteUrl: 'https://example.com///', path: '/about' }),
    ).toBe('https://example.com/about');
  });

  it('treats missing locale as base', () => {
    expect(
      buildCanonicalUrl({ siteUrl: 'https://example.com', baseLocale: 'en', path: '/about' }),
    ).toBe('https://example.com/about');
  });

  it('treats locale === baseLocale as base (no prefix)', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        locale: 'en',
        baseLocale: 'en',
        path: '/about',
      }),
    ).toBe('https://example.com/about');
  });

  it('emits prefix for non-base locale', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        locale: 'de',
        baseLocale: 'en',
        path: '/about',
      }),
    ).toBe('https://example.com/de/about');
  });

  it('handles root path "/" for base locale', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        locale: 'en',
        baseLocale: 'en',
        path: '/',
      }),
    ).toBe('https://example.com/');
  });

  it('handles root path "/" for non-base locale', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        locale: 'de',
        baseLocale: 'en',
        path: '/',
      }),
    ).toBe('https://example.com/de');
  });

  it('lowercases locale defensively', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        locale: 'DE',
        baseLocale: 'en',
        path: '/about',
      }),
    ).toBe('https://example.com/de/about');
  });

  it('lowercases baseLocale defensively', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        locale: 'en',
        baseLocale: 'EN',
        path: '/about',
      }),
    ).toBe('https://example.com/about');
  });

  it('normalizes path: leading slash, no trailing slash, collapses doubles', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        baseLocale: 'en',
        path: 'about/',
      }),
    ).toBe('https://example.com/about');
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        baseLocale: 'en',
        path: '//about//page///',
      }),
    ).toBe('https://example.com/about/page');
  });

  it('handles empty path as root', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        baseLocale: 'en',
        path: '',
      }),
    ).toBe('https://example.com/');
  });

  it('handles nested paths under non-base locale', () => {
    expect(
      buildCanonicalUrl({
        siteUrl: 'https://example.com',
        locale: 'de',
        baseLocale: 'en',
        path: '/blog/2026/post-1',
      }),
    ).toBe('https://example.com/de/blog/2026/post-1');
  });
});

describe('buildCanonicalUrl with trailingSlash', () => {
  const base = { siteUrl: 'https://example.com', baseLocale: 'en' };

  it('appends a trailing slash to base-locale sub-paths', () => {
    expect(buildCanonicalUrl({ ...base, path: '/about', trailingSlash: true })).toBe(
      'https://example.com/about/',
    );
  });

  it('appends a trailing slash to non-base-locale sub-paths', () => {
    expect(
      buildCanonicalUrl({ ...base, locale: 'de', path: '/about', trailingSlash: true }),
    ).toBe('https://example.com/de/about/');
  });

  it('appends a trailing slash to the locale root', () => {
    expect(buildCanonicalUrl({ ...base, locale: 'de', path: '/', trailingSlash: true })).toBe(
      'https://example.com/de/',
    );
  });

  it('leaves the base-locale root as a single slash', () => {
    expect(buildCanonicalUrl({ ...base, path: '/', trailingSlash: true })).toBe(
      'https://example.com/',
    );
    expect(buildCanonicalUrl({ ...base, path: '', trailingSlash: true })).toBe(
      'https://example.com/',
    );
  });

  it('appends a trailing slash to nested paths', () => {
    expect(
      buildCanonicalUrl({ ...base, locale: 'de', path: '/blog/2026/post-1', trailingSlash: true }),
    ).toBe('https://example.com/de/blog/2026/post-1/');
  });

  it('is idempotent when the input path already has a trailing slash', () => {
    expect(buildCanonicalUrl({ ...base, path: '/about/', trailingSlash: true })).toBe(
      'https://example.com/about/',
    );
    expect(buildCanonicalUrl({ ...base, path: '//about//', trailingSlash: true })).toBe(
      'https://example.com/about/',
    );
  });

  it('default (false) is byte-identical to the no-slash scheme', () => {
    expect(buildCanonicalUrl({ ...base, path: '/about' })).toBe('https://example.com/about');
    expect(buildCanonicalUrl({ ...base, path: '/about', trailingSlash: false })).toBe(
      'https://example.com/about',
    );
    expect(
      buildCanonicalUrl({ ...base, locale: 'de', path: '/about', trailingSlash: false }),
    ).toBe('https://example.com/de/about');
  });
});
