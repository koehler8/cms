/**
 * Classify a file under site/assets/img/** as one of:
 *   'original' — a hand-authored source image we should generate variants from
 *   'variant'  — a previously-generated variant matching {name}-{width}.{format}
 *                where width is one of the configured widths
 *   'ignore'   — anything else (non-image file, README, etc.)
 *
 * The classifier is the bridge between the flat-dir convention and the old
 * _source/ convention: by recognizing the variant naming pattern, we can keep
 * originals and variants in the same directory without confusion. Files that
 * happen to look variant-shaped but use widths outside the configured set
 * (e.g. `team-2024.jpg`) are treated as originals — the documented escape
 * hatch is to rename source files that genuinely conflict.
 */

import path from 'node:path';

export const SOURCE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif',
]);

export const FORMAT_OUTPUT_EXT = {
  avif: 'avif',
  webp: 'webp',
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
};

const VARIANT_FORMAT_EXTS = new Set(['avif', 'webp', 'jpg', 'jpeg']);

/**
 * @param {string} relPath - File path relative to site/assets/img/
 * @param {Set<number>} configWidths - Set of widths considered "variant widths"
 * @returns {'original' | 'variant' | 'ignore'}
 */
export function classifyImageFile(relPath, configWidths) {
  const parsed = path.parse(relPath);
  const ext = parsed.ext.toLowerCase().slice(1);

  if (ext === 'svg') return 'original';
  if (!ext) return 'ignore';
  if (!SOURCE_EXTENSIONS.has(`.${ext}`)) return 'ignore';

  const m = parsed.name.match(/^(.+)-(\d+)$/);
  if (!m) return 'original';
  if (!VARIANT_FORMAT_EXTS.has(ext)) return 'original';

  const width = Number.parseInt(m[2], 10);
  if (!configWidths.has(width)) return 'original';

  return 'variant';
}
