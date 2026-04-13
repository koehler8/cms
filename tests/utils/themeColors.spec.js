import { describe, it, expect } from 'vitest';
import {
  resolveThemeColor,
  resolveThemePalette,
  DEFAULT_THEME_COLOR_ORDER,
  setActiveThemeKey,
} from '../../src/utils/themeColors.js';

describe('themeColors', () => {
  describe('resolveThemeColor', () => {
    it('returns null for falsy input', () => {
      expect(resolveThemeColor(null)).toBeNull();
      expect(resolveThemeColor('')).toBeNull();
      expect(resolveThemeColor(undefined)).toBeNull();
    });

    it('resolves colors from the active theme palette', () => {
      setActiveThemeKey('base');
      const color = resolveThemeColor('primary');
      // Base theme should have a primary color
      expect(color).toBeTruthy();
      expect(typeof color).toBe('string');
    });

    it('falls back to hardcoded hex colors', () => {
      expect(resolveThemeColor('neon_pink')).toBe('#ff2d86');
      expect(resolveThemeColor('crimson_red')).toBe('#d9164b');
      expect(resolveThemeColor('electric_blue')).toBe('#27f3ff');
    });

    it('returns null for unknown color keys', () => {
      expect(resolveThemeColor('completely_unknown_color')).toBeNull();
    });

    it('is case-insensitive', () => {
      const lower = resolveThemeColor('neon_pink');
      const upper = resolveThemeColor('NEON_PINK');
      expect(lower).toBe(upper);
    });
  });

  describe('resolveThemePalette', () => {
    it('returns array of resolved colors', () => {
      const palette = resolveThemePalette(['neon_pink', 'electric_blue']);
      expect(palette).toEqual(['#ff2d86', '#27f3ff']);
    });

    it('filters out unresolvable keys', () => {
      const palette = resolveThemePalette(['neon_pink', 'unknown', 'electric_blue']);
      expect(palette).toEqual(['#ff2d86', '#27f3ff']);
    });

    it('returns empty array for non-array input', () => {
      expect(resolveThemePalette(null)).toEqual([]);
      expect(resolveThemePalette('string')).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(resolveThemePalette([])).toEqual([]);
    });
  });

  describe('DEFAULT_THEME_COLOR_ORDER', () => {
    it('is a non-empty array of color names', () => {
      expect(Array.isArray(DEFAULT_THEME_COLOR_ORDER)).toBe(true);
      expect(DEFAULT_THEME_COLOR_ORDER.length).toBeGreaterThan(0);
    });

    it('contains known fallback colors', () => {
      expect(DEFAULT_THEME_COLOR_ORDER).toContain('neon_pink');
      expect(DEFAULT_THEME_COLOR_ORDER).toContain('electric_blue');
    });
  });

  describe('setActiveThemeKey', () => {
    it('normalizes to lowercase', () => {
      setActiveThemeKey('BASE');
      const color = resolveThemeColor('primary');
      expect(color).toBeTruthy();
    });

    it('defaults to base for empty/falsy key', () => {
      setActiveThemeKey('');
      const color = resolveThemeColor('primary');
      expect(color).toBeTruthy();
    });
  });
});
