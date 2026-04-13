import { describe, it, expect } from 'vitest';
import {
  getThemeCatalog,
  getThemeManifest,
  resolveThemeManifest,
  listThemeMetadata,
} from '../../src/themes/themeLoader.js';

describe('themeLoader', () => {
  describe('getThemeCatalog', () => {
    it('returns an object', () => {
      const catalog = getThemeCatalog();
      expect(typeof catalog).toBe('object');
    });

    it('includes base theme', () => {
      const catalog = getThemeCatalog();
      expect(catalog.base).toBeDefined();
      expect(catalog.base.slug).toBe('base');
    });
  });

  describe('getThemeManifest', () => {
    it('returns manifest for known slug', () => {
      const manifest = getThemeManifest('base');
      expect(manifest).not.toBeNull();
      expect(manifest.slug).toBe('base');
    });

    it('is case-insensitive', () => {
      const manifest = getThemeManifest('BASE');
      expect(manifest).not.toBeNull();
      expect(manifest.slug).toBe('base');
    });

    it('returns null for unknown slug', () => {
      expect(getThemeManifest('nonexistent')).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(getThemeManifest(null)).toBeNull();
      expect(getThemeManifest(42)).toBeNull();
    });

    it('trims whitespace', () => {
      const manifest = getThemeManifest('  base  ');
      expect(manifest).not.toBeNull();
    });
  });

  describe('resolveThemeManifest', () => {
    it('returns requested theme when found', () => {
      const manifest = resolveThemeManifest('base');
      expect(manifest.slug).toBe('base');
    });

    it('falls back to base theme for unknown key', () => {
      const manifest = resolveThemeManifest('nonexistent');
      expect(manifest).not.toBeNull();
      expect(manifest.slug).toBe('base');
    });

    it('returns something for null input', () => {
      const manifest = resolveThemeManifest(null);
      expect(manifest).not.toBeNull();
    });
  });

  describe('listThemeMetadata', () => {
    it('returns array of { slug, meta } objects', () => {
      const list = listThemeMetadata();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty('slug');
      expect(list[0]).toHaveProperty('meta');
    });

    it('includes base theme', () => {
      const list = listThemeMetadata();
      const base = list.find((t) => t.slug === 'base');
      expect(base).toBeDefined();
    });
  });
});
