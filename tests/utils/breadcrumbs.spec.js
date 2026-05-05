import { describe, it, expect } from 'vitest';
import { buildBreadcrumbList } from '../../src/utils/breadcrumbs.js';

function setup(overrides = {}) {
  return buildBreadcrumbList({
    siteUrl: overrides.siteUrl ?? 'https://example.com',
    currentPage: overrides.currentPage ?? { path: '/about' },
    pages: overrides.pages ?? {},
    baseLocale: overrides.baseLocale ?? 'en',
    locale: overrides.locale ?? '',
  });
}

describe('buildBreadcrumbList', () => {
  it('returns null on the home page', () => {
    expect(setup({ currentPage: { path: '/' } })).toBeNull();
  });

  it('returns null on draft pages', () => {
    expect(setup({ currentPage: { path: '/about', draft: true } })).toBeNull();
  });

  it('returns null on 404 pages', () => {
    expect(setup({ currentPage: { path: '/missing', isNotFound: true } })).toBeNull();
  });

  it('returns null when site.url is missing', () => {
    expect(setup({ siteUrl: '' })).toBeNull();
  });

  it('returns null when currentPage opts out via meta.breadcrumbs:false', () => {
    expect(
      setup({ currentPage: { path: '/about', meta: { breadcrumbs: false } } }),
    ).toBeNull();
  });

  it('emits 2 entries for a single-level page (Home + leaf)', () => {
    const list = setup({ currentPage: { path: '/about' } });
    expect(list).not.toBeNull();
    expect(list['@type']).toBe('BreadcrumbList');
    expect(list.itemListElement).toHaveLength(2);
    expect(list.itemListElement[0].name).toBe('Home');
    expect(list.itemListElement[0].item).toBe('https://example.com/');
    expect(list.itemListElement[1].name).toBe('About');
    expect(list.itemListElement[1].item).toBe('https://example.com/about');
  });

  it('emits N+1 entries for a nested path', () => {
    const list = setup({ currentPage: { path: '/blog/2026/post-1' } });
    expect(list.itemListElement).toHaveLength(4);
    expect(list.itemListElement.map((e) => e.name)).toEqual([
      'Home',
      'Blog',
      '2026',
      'Post 1',
    ]);
    expect(list.itemListElement.map((e) => e.item)).toEqual([
      'https://example.com/',
      'https://example.com/blog',
      'https://example.com/blog/2026',
      'https://example.com/blog/2026/post-1',
    ]);
  });

  it('uses page.meta.title for known intermediate paths', () => {
    const list = setup({
      currentPage: { path: '/blog/2026/post-1' },
      pages: {
        blog: { path: '/blog', meta: { title: 'Our Blog' } },
        archive2026: { path: '/blog/2026', meta: { title: 'Year 2026' } },
      },
    });
    expect(list.itemListElement[1].name).toBe('Our Blog');
    expect(list.itemListElement[2].name).toBe('Year 2026');
    // Leaf still falls back to slug formatting (no matching page).
    expect(list.itemListElement[3].name).toBe('Post 1');
  });

  it('uses page.meta.title for the leaf when the page is known', () => {
    const list = setup({
      currentPage: { path: '/about', meta: { title: 'All About Us' } },
      pages: {
        about: { path: '/about', meta: { title: 'All About Us' } },
      },
    });
    expect(list.itemListElement[1].name).toBe('All About Us');
  });

  it('preserves position numbers in order', () => {
    const list = setup({ currentPage: { path: '/a/b/c' } });
    expect(list.itemListElement.map((e) => e.position)).toEqual([1, 2, 3, 4]);
  });

  it('emits @context = schema.org', () => {
    const list = setup({ currentPage: { path: '/about' } });
    expect(list['@context']).toBe('https://schema.org');
  });

  it('renders locale-prefixed URLs when locale is non-base', () => {
    const list = setup({
      currentPage: { path: '/about' },
      baseLocale: 'en',
      locale: 'de',
    });
    expect(list.itemListElement[0].item).toBe('https://example.com/de');
    expect(list.itemListElement[1].item).toBe('https://example.com/de/about');
  });

  it('treats locale === baseLocale as base (no prefix in URLs)', () => {
    const list = setup({
      currentPage: { path: '/about' },
      baseLocale: 'en',
      locale: 'en',
    });
    expect(list.itemListElement[0].item).toBe('https://example.com/');
    expect(list.itemListElement[1].item).toBe('https://example.com/about');
  });

  it('handles trailing slash in currentPage.path', () => {
    const list = setup({ currentPage: { path: '/about/' } });
    expect(list.itemListElement).toHaveLength(2);
    expect(list.itemListElement[1].item).toBe('https://example.com/about');
  });

  it('handles snake_case slugs', () => {
    const list = setup({ currentPage: { path: '/our_team/jamie_austin' } });
    expect(list.itemListElement.map((e) => e.name)).toEqual([
      'Home',
      'Our Team',
      'Jamie Austin',
    ]);
  });

  it('strips trailing slash from siteUrl', () => {
    const list = setup({
      siteUrl: 'https://example.com/',
      currentPage: { path: '/about' },
    });
    expect(list.itemListElement[0].item).toBe('https://example.com/');
  });

  it('returns null for invalid currentPage', () => {
    expect(buildBreadcrumbList({ siteUrl: 'https://example.com' })).toBeNull();
    expect(
      buildBreadcrumbList({
        siteUrl: 'https://example.com',
        currentPage: null,
      }),
    ).toBeNull();
  });
});
