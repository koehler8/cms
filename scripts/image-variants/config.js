/**
 * Image-variant pipeline configuration.
 *
 * Resolves the `imageVariants` block from a site's `site.json` into a
 * normalized config object: { widths: number[], formats: string[],
 * quality: { avif, webp, jpg } }. Falls back to sensible marketing-site
 * defaults when fields are missing or invalid.
 */

import { FORMAT_OUTPUT_EXT } from './classifier.js';

export const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920, 2560];
export const DEFAULT_FORMATS = ['avif', 'webp', 'jpg'];
export const DEFAULT_QUALITY = { avif: 60, webp: 75, jpg: 80 };

function normalizeWidths(input) {
  if (!Array.isArray(input)) return [...DEFAULT_WIDTHS];
  const filtered = input
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!filtered.length) return [...DEFAULT_WIDTHS];
  return [...new Set(filtered)].sort((a, b) => a - b);
}

function normalizeFormats(input) {
  if (!Array.isArray(input)) return [...DEFAULT_FORMATS];
  const filtered = input
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter((v) => v && FORMAT_OUTPUT_EXT[v]);
  if (!filtered.length) return [...DEFAULT_FORMATS];
  return [...new Set(filtered)];
}

function normalizeQuality(input) {
  const merged = { ...DEFAULT_QUALITY };
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 100) merged[k] = n;
    }
  }
  return merged;
}

export function resolveImageVariantConfig(siteConfig) {
  const block = (siteConfig?.imageVariants && typeof siteConfig.imageVariants === 'object')
    ? siteConfig.imageVariants
    : {};
  return {
    widths: normalizeWidths(block.widths),
    formats: normalizeFormats(block.formats),
    quality: normalizeQuality(block.quality),
  };
}
