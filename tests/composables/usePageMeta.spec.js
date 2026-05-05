import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock @unhead/vue. We capture the head factory so tests can read what it
// would emit (title + meta array) without an active unhead context.
let lastHeadFactory = null;
vi.mock('@unhead/vue', () => ({
  useHead: vi.fn((arg) => {
    lastHeadFactory = typeof arg === 'function' ? arg : () => arg;
  }),
}));

// Mock the loadConfig singletons so tests can vary availableLocales /
// baseLocale per-case. The mock returns getters that read from mutable
// module-level state so changes between tests are picked up.
const mockState = {
  availableLocales: [],
  baseLocale: '',
};
vi.mock('../../src/utils/loadConfig.js', () => ({
  get availableLocales() { return mockState.availableLocales; },
  get baseLocale() { return mockState.baseLocale; },
}));

import { usePageMeta } from '../../src/composables/usePageMeta.js';

function readHead() {
  if (!lastHeadFactory) return { title: '', meta: [], link: [] };
  return lastHeadFactory();
}

describe('usePageMeta', () => {
  function setup(siteOverrides = {}, pageOverrides = {}, options = {}) {
    lastHeadFactory = null;
    mockState.availableLocales = options.availableLocales ?? [];
    mockState.baseLocale = options.baseLocale ?? '';
    const siteData = ref({
      site: { title: 'My Site', description: 'Site description', ...siteOverrides },
    });
    const currentPage = ref(pageOverrides);
    return usePageMeta({ siteData, currentPage, locale: () => options.locale ?? '' });
  }

  beforeEach(() => {
    mockState.availableLocales = [];
    mockState.baseLocale = '';
  });

  describe('pageMetaTitle', () => {
    it('returns site title for home page', () => {
      const { pageMetaTitle } = setup({}, { id: 'home', path: '/' });
      expect(pageMetaTitle.value).toBe('My Site');
    });

    it('returns explicit meta title when set', () => {
      const { pageMetaTitle } = setup({}, { meta: { title: 'Custom Title' } });
      expect(pageMetaTitle.value).toBe('Custom Title');
    });

    it('generates title from path for dynamic pages', () => {
      const { pageMetaTitle } = setup({}, { path: '/about-us' });
      expect(pageMetaTitle.value).toBe('About Us — My Site');
    });

    it('uses special labels for known page IDs', () => {
      const { pageMetaTitle } = setup({}, { id: 'terms' });
      expect(pageMetaTitle.value).toBe('Terms of Service — My Site');
    });

    it('uses special labels for privacy page', () => {
      const { pageMetaTitle } = setup({}, { id: 'privacy' });
      expect(pageMetaTitle.value).toBe('Privacy Policy — My Site');
    });

    it('uses special labels for cookies page', () => {
      const { pageMetaTitle } = setup({}, { id: 'cookies' });
      expect(pageMetaTitle.value).toBe('Cookie Policy — My Site');
    });

    it('converts kebab-case paths to title case', () => {
      const { pageMetaTitle } = setup({}, { path: '/my-awesome-page' });
      expect(pageMetaTitle.value).toBe('My Awesome Page — My Site');
    });

    it('handles nested paths', () => {
      const { pageMetaTitle } = setup({}, { path: '/docs/getting-started' });
      expect(pageMetaTitle.value).toBe('Docs / Getting Started — My Site');
    });
  });

  describe('pageMetaDescription', () => {
    it('returns site description by default', () => {
      const { pageMetaDescription } = setup();
      expect(pageMetaDescription.value).toBe('Site description');
    });

    it('uses explicit page description when set', () => {
      const { pageMetaDescription } = setup({}, { meta: { description: 'Page desc' } });
      expect(pageMetaDescription.value).toBe('Page desc');
    });

    it('ignores whitespace-only descriptions', () => {
      const { pageMetaDescription } = setup({}, { meta: { description: '   ' } });
      expect(pageMetaDescription.value).toBe('Site description');
    });
  });

  describe('draft / noindex meta', () => {
    it('does not emit robots meta for non-draft pages', () => {
      setup({}, { id: 'home', path: '/' });
      const head = readHead();
      const robots = head.meta.find((m) => m.name === 'robots');
      expect(robots).toBeUndefined();
    });

    it('emits noindex,nofollow for site-wide draft', () => {
      setup({ draft: true }, { id: 'home', path: '/' });
      const head = readHead();
      const robots = head.meta.find((m) => m.name === 'robots');
      expect(robots).toBeDefined();
      expect(robots.content).toBe('noindex, nofollow');
    });

    it('emits noindex for page with draft:true', () => {
      setup({}, { id: 'wip', path: '/wip', draft: true });
      const head = readHead();
      const robots = head.meta.find((m) => m.name === 'robots');
      expect(robots).toBeDefined();
    });

    it('emits noindex for page under a draftPaths prefix', () => {
      setup({ draftPaths: ['/blog/2026'] }, { id: 'post', path: '/blog/2026/post-1' });
      const head = readHead();
      const robots = head.meta.find((m) => m.name === 'robots');
      expect(robots).toBeDefined();
    });

    it('page-level draft:false override suppresses noindex', () => {
      setup({ draft: true }, { id: 'public-page', path: '/public', draft: false });
      const head = readHead();
      const robots = head.meta.find((m) => m.name === 'robots');
      expect(robots).toBeUndefined();
    });

    it('exposes isDraft computed', () => {
      const { isDraft } = setup({ draft: true }, { id: 'home', path: '/' });
      expect(isDraft.value).toBe(true);
    });

    it('emits generic title for draft pages so the slug does not leak', () => {
      const { pageMetaTitle } = setup({}, { id: 'wip', path: '/wip', draft: true });
      expect(pageMetaTitle.value).toBe('Draft — My Site');
    });

    it('generic title even when page has explicit meta.title', () => {
      const { pageMetaTitle } = setup(
        {},
        { id: 'wip', path: '/wip', draft: true, meta: { title: 'Top Secret Plan' } },
      );
      expect(pageMetaTitle.value).toBe('Draft — My Site');
      expect(pageMetaTitle.value).not.toContain('Top Secret');
    });

    it('falls back to "Draft" alone when site has no title', () => {
      const { pageMetaTitle } = setup({ title: '' }, { id: 'wip', path: '/wip', draft: true });
      expect(pageMetaTitle.value).toBe('Draft');
    });

    it('suppresses page description on draft pages', () => {
      const { pageMetaDescription } = setup(
        {},
        { id: 'wip', path: '/wip', draft: true, meta: { description: 'Confidential.' } },
      );
      expect(pageMetaDescription.value).toBe('');
    });
  });

  describe('canonical link', () => {
    it('emits <link rel="canonical"> for non-draft pages with site.url', () => {
      setup(
        { url: 'https://example.com' },
        { id: 'about', path: '/about' },
        { availableLocales: ['en'], baseLocale: 'en' },
      );
      const head = readHead();
      const canonical = head.link.find((l) => l.rel === 'canonical');
      expect(canonical).toBeDefined();
      expect(canonical.href).toBe('https://example.com/about');
    });

    it('does NOT emit canonical for draft pages', () => {
      setup(
        { url: 'https://example.com' },
        { id: 'wip', path: '/wip', draft: true },
        { availableLocales: ['en'], baseLocale: 'en' },
      );
      const head = readHead();
      const canonical = head.link.find((l) => l.rel === 'canonical');
      expect(canonical).toBeUndefined();
    });

    it('does NOT emit canonical when site.url is missing', () => {
      setup(
        {},
        { id: 'about', path: '/about' },
        { availableLocales: ['en'], baseLocale: 'en' },
      );
      const head = readHead();
      const canonical = head.link.find((l) => l.rel === 'canonical');
      expect(canonical).toBeUndefined();
    });

    it('non-base locale produces /{locale}/path canonical', () => {
      setup(
        { url: 'https://example.com' },
        { id: 'about', path: '/about' },
        { availableLocales: ['en', 'de'], baseLocale: 'en', locale: 'de' },
      );
      const head = readHead();
      const canonical = head.link.find((l) => l.rel === 'canonical');
      expect(canonical.href).toBe('https://example.com/de/about');
    });

    it('base locale on home page emits root canonical', () => {
      setup(
        { url: 'https://example.com' },
        { id: 'home', path: '/' },
        { availableLocales: ['en'], baseLocale: 'en' },
      );
      const head = readHead();
      const canonical = head.link.find((l) => l.rel === 'canonical');
      expect(canonical.href).toBe('https://example.com/');
    });
  });

  describe('hreflang alternates', () => {
    it('does NOT emit hreflang for single-locale sites', () => {
      setup(
        { url: 'https://example.com' },
        { id: 'about', path: '/about' },
        { availableLocales: ['en'], baseLocale: 'en' },
      );
      const head = readHead();
      const hreflangs = head.link.filter((l) => l.rel === 'alternate');
      expect(hreflangs).toEqual([]);
    });

    it('emits one hreflang per available locale + x-default for multi-locale', () => {
      setup(
        { url: 'https://example.com' },
        { id: 'about', path: '/about' },
        { availableLocales: ['en', 'de', 'fr'], baseLocale: 'en' },
      );
      const head = readHead();
      const hreflangs = head.link.filter((l) => l.rel === 'alternate');
      const codes = hreflangs.map((h) => h.hreflang).sort();
      expect(codes).toEqual(['de', 'en', 'fr', 'x-default']);
      const en = hreflangs.find((h) => h.hreflang === 'en');
      const de = hreflangs.find((h) => h.hreflang === 'de');
      const xdef = hreflangs.find((h) => h.hreflang === 'x-default');
      expect(en.href).toBe('https://example.com/about');
      expect(de.href).toBe('https://example.com/de/about');
      expect(xdef.href).toBe('https://example.com/about');
    });

    it('does NOT emit hreflang for draft pages even on multi-locale sites', () => {
      setup(
        { url: 'https://example.com' },
        { id: 'wip', path: '/wip', draft: true },
        { availableLocales: ['en', 'de'], baseLocale: 'en' },
      );
      const head = readHead();
      const hreflangs = head.link.filter((l) => l.rel === 'alternate');
      expect(hreflangs).toEqual([]);
    });

    it('does NOT emit hreflang when site.url is missing', () => {
      setup(
        {},
        { id: 'about', path: '/about' },
        { availableLocales: ['en', 'de'], baseLocale: 'en' },
      );
      const head = readHead();
      const hreflangs = head.link.filter((l) => l.rel === 'alternate');
      expect(hreflangs).toEqual([]);
    });
  });
});
