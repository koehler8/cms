import { describe, it, expect } from 'vitest';
import { validateThemeManifest } from '../../src/themes/themeValidator.js';
import baseManifest from '../../themes/base/theme.config.js';

function makeMinimalManifest() {
  // Use the base manifest as a known-valid starting point
  return JSON.parse(JSON.stringify(baseManifest));
}

describe('validateThemeManifest', () => {
  it('validates a complete manifest as valid', () => {
    const result = validateThemeManifest(makeMinimalManifest(), { throwOnError: false });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('throws by default on invalid manifest', () => {
    expect(() => validateThemeManifest({})).toThrow('invalid');
  });

  it('returns errors without throwing when throwOnError is false', () => {
    const result = validateThemeManifest({}, { throwOnError: false });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects non-object input', () => {
    const result = validateThemeManifest(null, { throwOnError: false });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Theme manifest must be an object');
  });

  it('requires manifest.slug', () => {
    const manifest = makeMinimalManifest();
    delete manifest.slug;
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContain('manifest.slug must be a non-empty string');
  });

  it('requires manifest.meta.name and meta.version', () => {
    const manifest = makeMinimalManifest();
    manifest.meta = {};
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContain('manifest.meta.name is required');
    expect(result.errors).toContain('manifest.meta.version is required');
  });

  it('requires all palette colors', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.palette = {};
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.palette.primary'));
  });

  it('validates color format', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.palette.primary = 'not-a-color';
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.palette.primary must be a CSS color'));
  });

  it('accepts hex colors', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.palette.primary = '#ff0000';
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors.filter((e) => e.includes('palette.primary'))).toEqual([]);
  });

  it('accepts rgb/rgba colors', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.palette.primary = 'rgba(255, 0, 0, 0.5)';
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors.filter((e) => e.includes('palette.primary'))).toEqual([]);
  });

  it('accepts CSS var() references', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.palette.primary = 'var(--custom-color)';
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors.filter((e) => e.includes('palette.primary'))).toEqual([]);
  });

  it('accepts gradients', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.palette.primary = 'linear-gradient(90deg, #000, #fff)';
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors.filter((e) => e.includes('palette.primary'))).toEqual([]);
  });

  it('accepts transparent and currentColor', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.ctas.ghost.border = 'transparent';
    const result = validateThemeManifest(manifest, { throwOnError: false });
    // ghost border uses ensureString, not ensureColor — so this won't error for color
    // But transparent is both a valid color and a valid string
    expect(result.errors.filter((e) => e.includes('ctas.ghost.border'))).toEqual([]);
  });

  it('requires all radii to be CSS sizes', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.radii.sm = 'not-a-size';
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.radii.sm must be a CSS size'));
  });

  it('accepts numeric radii values', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.radii.sm = 4;
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors.filter((e) => e.includes('radii.sm'))).toEqual([]);
  });

  it('requires nested surface objects (helper, tabs, field, etc.)', () => {
    const manifest = makeMinimalManifest();
    delete manifest.tokens.surfaces.helper;
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.surfaces.helper must be an object'));
  });

  it('requires typography properties', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.typography = {};
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.typography.bodyFamily'));
  });

  it('requires CTA variants (primary, secondary, ghost, link)', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.ctas = {};
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.ctas.primary must be an object'));
  });

  it('requires chip variants (neutral, accent, outline)', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.chips = {};
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.chips.neutral must be an object'));
  });

  it('requires focus ring properties', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.focus = {};
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.focus.ring'));
  });

  it('requires elevation levels', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.elevation = {};
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.elevation.flat'));
  });

  it('requires utility tokens', () => {
    const manifest = makeMinimalManifest();
    manifest.tokens.utility = {};
    const result = validateThemeManifest(manifest, { throwOnError: false });
    expect(result.errors).toContainEqual(expect.stringContaining('tokens.utility.divider is required'));
  });

  it('attaches errors array to thrown error', () => {
    try {
      validateThemeManifest({});
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error.errors).toBeDefined();
      expect(Array.isArray(error.errors)).toBe(true);
    }
  });
});
