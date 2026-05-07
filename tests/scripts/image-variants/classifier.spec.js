import { describe, it, expect } from 'vitest';
import { classifyImageFile } from '../../../scripts/image-variants/classifier.js';

const DEFAULT_WIDTHS = new Set([320, 640, 960, 1280, 1920, 2560]);

describe('classifyImageFile', () => {
  it('classifies bare image filenames as originals', () => {
    expect(classifyImageFile('logo.png', DEFAULT_WIDTHS)).toBe('original');
    expect(classifyImageFile('hero.jpg', DEFAULT_WIDTHS)).toBe('original');
    expect(classifyImageFile('promo.webp', DEFAULT_WIDTHS)).toBe('original');
  });

  it('classifies SVGs as originals (no variant generation)', () => {
    expect(classifyImageFile('icon.svg', DEFAULT_WIDTHS)).toBe('original');
  });

  it('classifies non-image files as ignore', () => {
    expect(classifyImageFile('README.md', DEFAULT_WIDTHS)).toBe('ignore');
    expect(classifyImageFile('notes.txt', DEFAULT_WIDTHS)).toBe('ignore');
    expect(classifyImageFile('no-extension', DEFAULT_WIDTHS)).toBe('ignore');
  });

  it('classifies {name}-{width}.{format} as variant when width is configured', () => {
    expect(classifyImageFile('logo-320.webp', DEFAULT_WIDTHS)).toBe('variant');
    expect(classifyImageFile('hero-1920.avif', DEFAULT_WIDTHS)).toBe('variant');
    expect(classifyImageFile('promo-2560.jpg', DEFAULT_WIDTHS)).toBe('variant');
  });

  it('classifies variant-shaped names with non-configured widths as originals', () => {
    expect(classifyImageFile('team-2024.jpg', DEFAULT_WIDTHS)).toBe('original');
    expect(classifyImageFile('photo-100.webp', DEFAULT_WIDTHS)).toBe('original');
    expect(classifyImageFile('logo-300.png', DEFAULT_WIDTHS)).toBe('original');
  });

  it('classifies variant-shaped PNG files as originals (PNG is not a variant format)', () => {
    expect(classifyImageFile('logo-320.png', DEFAULT_WIDTHS)).toBe('original');
  });

  it('respects custom widths set', () => {
    const custom = new Set([400, 800]);
    expect(classifyImageFile('logo-400.webp', custom)).toBe('variant');
    expect(classifyImageFile('logo-320.webp', custom)).toBe('original');
  });

  it('handles subdir-prefixed paths', () => {
    expect(classifyImageFile('team/jamie.jpg', DEFAULT_WIDTHS)).toBe('original');
    expect(classifyImageFile('users/avatar-320.webp', DEFAULT_WIDTHS)).toBe('variant');
  });
});
