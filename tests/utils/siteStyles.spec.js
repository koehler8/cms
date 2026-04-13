import { describe, it, expect, vi } from 'vitest';
import { createSiteStyleLoader } from '../../src/utils/siteStyles.js';

describe('siteStyles', () => {
  describe('createSiteStyleLoader', () => {
    it('creates a loader with ensureSiteStylesLoaded', () => {
      const loader = createSiteStyleLoader({});
      expect(typeof loader.ensureSiteStylesLoaded).toBe('function');
    });

    it('resolves to true when module loads successfully', async () => {
      const mockModule = { '/style.css': () => Promise.resolve({}) };
      const loader = createSiteStyleLoader(mockModule);
      const result = await loader.ensureSiteStylesLoaded();
      expect(result).toBe(true);
    });

    it('returns the same promise on multiple calls (caching)', async () => {
      const loadFn = vi.fn(() => Promise.resolve({}));
      const mockModule = { '/style.css': loadFn };
      const loader = createSiteStyleLoader(mockModule);

      const promise1 = loader.ensureSiteStylesLoaded();
      const promise2 = loader.ensureSiteStylesLoaded();

      expect(promise1).toBe(promise2);
      await promise1;
      expect(loadFn).toHaveBeenCalledOnce();
    });

    it('resolves to false when no modules provided', async () => {
      const loader = createSiteStyleLoader({});
      const result = await loader.ensureSiteStylesLoaded();
      expect(result).toBe(false);
    });
  });
});
