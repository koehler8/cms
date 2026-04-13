import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useComingSoonResolver, COMING_SOON_PREFIX } from '../../src/composables/useComingSoonConfig.js';

describe('useComingSoonConfig', () => {
  describe('COMING_SOON_PREFIX', () => {
    it('equals "coming-soon"', () => {
      expect(COMING_SOON_PREFIX).toBe('coming-soon');
    });
  });

  describe('isComingSoonAction', () => {
    const { isComingSoonAction } = useComingSoonResolver(ref({}));

    it('returns true for "coming-soon"', () => {
      expect(isComingSoonAction('coming-soon')).toBe(true);
    });

    it('returns true for "coming-soon:variant"', () => {
      expect(isComingSoonAction('coming-soon:beta')).toBe(true);
    });

    it('returns true case-insensitively', () => {
      expect(isComingSoonAction('Coming-Soon')).toBe(true);
    });

    it('returns false for regular hrefs', () => {
      expect(isComingSoonAction('/about')).toBe(false);
      expect(isComingSoonAction('https://example.com')).toBe(false);
    });

    it('returns false for null/undefined/empty', () => {
      expect(isComingSoonAction(null)).toBe(false);
      expect(isComingSoonAction(undefined)).toBe(false);
      expect(isComingSoonAction('')).toBe(false);
    });
  });

  describe('resolve', () => {
    it('returns default modal for "coming-soon" with no config', () => {
      const { resolve } = useComingSoonResolver(ref({}));
      const result = resolve({ href: 'coming-soon' });
      expect(result.title).toBe('Coming Soon');
      expect(result.message).toBeTruthy();
      expect(result.variant).toBeNull();
    });

    it('returns null for non-coming-soon href', () => {
      const { resolve } = useComingSoonResolver(ref({}));
      expect(resolve({ href: '/about' })).toBeNull();
    });

    it('resolves a specific variant', () => {
      const pageContent = ref({
        comingSoon: {
          title: 'Default Title',
          message: 'Default Message',
          variants: {
            beta: {
              title: 'Beta Title',
              message: 'Beta Message',
            },
          },
        },
      });
      const { resolve } = useComingSoonResolver(pageContent);
      const result = resolve({ href: 'coming-soon:beta' });
      expect(result.title).toBe('Beta Title');
      expect(result.message).toBe('Beta Message');
      expect(result.variant).toBe('beta');
    });

    it('falls back to base config when variant not found', () => {
      const pageContent = ref({
        comingSoon: {
          title: 'Base Title',
          message: 'Base Message',
        },
      });
      const { resolve } = useComingSoonResolver(pageContent);
      const result = resolve({ href: 'coming-soon:missing' });
      expect(result.title).toBe('Base Title');
    });

    it('returns null for empty href', () => {
      const { resolve } = useComingSoonResolver(ref({}));
      expect(resolve({ href: '' })).toBeNull();
      expect(resolve({})).toBeNull();
    });
  });
});
