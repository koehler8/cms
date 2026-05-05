import { describe, it, expect } from 'vitest';
import { buildSocialMeta } from '../../src/utils/socialMeta.js';

function find(meta, attr, value) {
  return meta.find((m) => m[attr] === value);
}

describe('buildSocialMeta', () => {
  function setup(overrides = {}) {
    return buildSocialMeta({
      siteData: { site: { title: 'My Site', url: 'https://example.com', ...(overrides.site || {}) } },
      currentPage: { id: 'home', path: '/', meta: {}, ...(overrides.page || {}) },
      pageTitle: overrides.pageTitle ?? 'Home Page Title',
      pageDescription: overrides.pageDescription ?? 'Home page description.',
      canonicalHref: overrides.canonicalHref ?? 'https://example.com/',
      isDraft: overrides.isDraft || false,
      isNotFound: overrides.isNotFound || false,
    });
  }

  it('returns [] for drafts', () => {
    expect(setup({ isDraft: true })).toEqual([]);
  });

  it('returns [] for 404 pages', () => {
    expect(setup({ isNotFound: true })).toEqual([]);
  });

  it('emits og:title and twitter:title from pageTitle', () => {
    const meta = setup();
    expect(find(meta, 'property', 'og:title').content).toBe('Home Page Title');
    expect(find(meta, 'name', 'twitter:title').content).toBe('Home Page Title');
  });

  it('emits og:description and twitter:description from pageDescription', () => {
    const meta = setup();
    expect(find(meta, 'property', 'og:description').content).toBe('Home page description.');
    expect(find(meta, 'name', 'twitter:description').content).toBe('Home page description.');
  });

  it('omits og/twitter title when pageTitle is empty', () => {
    const meta = setup({ pageTitle: '' });
    expect(find(meta, 'property', 'og:title')).toBeUndefined();
    expect(find(meta, 'name', 'twitter:title')).toBeUndefined();
  });

  it('omits og/twitter description when pageDescription is empty', () => {
    const meta = setup({ pageDescription: '' });
    expect(find(meta, 'property', 'og:description')).toBeUndefined();
    expect(find(meta, 'name', 'twitter:description')).toBeUndefined();
  });

  it('emits og:url from canonicalHref', () => {
    const meta = setup({ canonicalHref: 'https://example.com/about' });
    expect(find(meta, 'property', 'og:url').content).toBe('https://example.com/about');
  });

  it('omits og:url when canonicalHref is empty', () => {
    const meta = setup({ canonicalHref: '' });
    expect(find(meta, 'property', 'og:url')).toBeUndefined();
  });

  it('emits og:type defaulting to "website"', () => {
    const meta = setup();
    expect(find(meta, 'property', 'og:type').content).toBe('website');
  });

  it('respects page.meta.ogType override (e.g. article)', () => {
    const meta = setup({ page: { meta: { ogType: 'article' } } });
    expect(find(meta, 'property', 'og:type').content).toBe('article');
  });

  it('emits twitter:card defaulting to "summary_large_image"', () => {
    const meta = setup();
    expect(find(meta, 'name', 'twitter:card').content).toBe('summary_large_image');
  });

  it('respects page.meta.twitterCard override', () => {
    const meta = setup({ page: { meta: { twitterCard: 'summary' } } });
    expect(find(meta, 'name', 'twitter:card').content).toBe('summary');
  });

  it('emits og:site_name from site.title', () => {
    const meta = setup();
    expect(find(meta, 'property', 'og:site_name').content).toBe('My Site');
  });

  describe('og:image resolution', () => {
    it('falls back to /og-image.jpg absolutized via siteUrl', () => {
      const meta = setup();
      expect(find(meta, 'property', 'og:image').content).toBe('https://example.com/og-image.jpg');
      expect(find(meta, 'name', 'twitter:image').content).toBe('https://example.com/og-image.jpg');
    });

    it('uses site.image when set', () => {
      const meta = setup({ site: { image: '/img/site-card.jpg' } });
      expect(find(meta, 'property', 'og:image').content).toBe('https://example.com/img/site-card.jpg');
    });

    it('uses page.meta.image when set (highest priority)', () => {
      const meta = setup({
        site: { image: '/img/site-card.jpg' },
        page: { meta: { image: '/img/page-card.jpg' } },
      });
      expect(find(meta, 'property', 'og:image').content).toBe('https://example.com/img/page-card.jpg');
    });

    it('keeps absolute image URLs as-is', () => {
      const meta = setup({ page: { meta: { image: 'https://cdn.example.com/og.jpg' } } });
      expect(find(meta, 'property', 'og:image').content).toBe('https://cdn.example.com/og.jpg');
    });

    it('emits relative path when siteUrl is missing', () => {
      const meta = setup({ site: { url: '' }, page: { meta: { image: '/img/page-card.jpg' } } });
      expect(find(meta, 'property', 'og:image').content).toBe('/img/page-card.jpg');
    });

    it('handles trailing slash on siteUrl', () => {
      const meta = setup({ site: { url: 'https://example.com/' } });
      expect(find(meta, 'property', 'og:image').content).toBe('https://example.com/og-image.jpg');
    });
  });
});
