import { describe, it, expect } from 'vitest';
import {
  resolveImageVariantConfig,
  DEFAULT_WIDTHS,
  DEFAULT_FORMATS,
  DEFAULT_QUALITY,
} from '../../../scripts/image-variants/config.js';

describe('resolveImageVariantConfig', () => {
  it('returns defaults when site config has no imageVariants block', () => {
    const c = resolveImageVariantConfig({});
    expect(c.widths).toEqual(DEFAULT_WIDTHS);
    expect(c.formats).toEqual(DEFAULT_FORMATS);
    expect(c.quality).toEqual(DEFAULT_QUALITY);
  });

  it('returns defaults when site config is null/undefined', () => {
    expect(resolveImageVariantConfig(undefined).widths).toEqual(DEFAULT_WIDTHS);
    expect(resolveImageVariantConfig(null).widths).toEqual(DEFAULT_WIDTHS);
  });

  it('honors custom widths and dedupes/sorts them', () => {
    const c = resolveImageVariantConfig({ imageVariants: { widths: [1280, 320, 320, 640] } });
    expect(c.widths).toEqual([320, 640, 1280]);
  });

  it('falls back to defaults when widths is empty / non-numeric', () => {
    expect(resolveImageVariantConfig({ imageVariants: { widths: [] } }).widths).toEqual(DEFAULT_WIDTHS);
    expect(resolveImageVariantConfig({ imageVariants: { widths: ['nope'] } }).widths).toEqual(DEFAULT_WIDTHS);
  });

  it('honors custom formats and rejects unknown ones', () => {
    const c = resolveImageVariantConfig({ imageVariants: { formats: ['webp', 'jpg', 'bogus'] } });
    expect(c.formats).toEqual(['webp', 'jpg']);
  });

  it('clamps quality to [1, 100] and merges with defaults', () => {
    const c = resolveImageVariantConfig({
      imageVariants: { quality: { avif: 999, webp: -10, jpg: 50 } },
    });
    expect(c.quality.jpg).toBe(50);
    expect(c.quality.avif).toBe(DEFAULT_QUALITY.avif);
    expect(c.quality.webp).toBe(DEFAULT_QUALITY.webp);
  });
});
