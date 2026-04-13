import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';

// Mock @unhead/vue since it requires SSR context
vi.mock('@unhead/vue', () => ({
  useHead: vi.fn(),
}));

import { usePageMeta } from '../../src/composables/usePageMeta.js';

describe('usePageMeta', () => {
  function setup(siteOverrides = {}, pageOverrides = {}) {
    const siteData = ref({
      site: { title: 'My Site', description: 'Site description', ...siteOverrides },
    });
    const currentPage = ref(pageOverrides);
    return usePageMeta({ siteData, currentPage });
  }

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
});
