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
