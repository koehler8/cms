/**
 * Walk site/assets/img/** (recursive), classify each file, and build a list
 * of variant-generation jobs.
 *
 * Each job is { sourceKey, sourcePath, outputs: [{ width, format, cacheRelPath }] }
 * where:
 *   sourceKey    - posix path relative to site/assets/ (e.g. "img/logo.png")
 *   sourcePath   - absolute disk path of the original
 *   cacheRelPath - posix path relative to the cache dir root, including the
 *                  `assets/img/` parent — so that the cache directory mirrors
 *                  the site's `assets/` layout. The `assets/` parent is
 *                  load-bearing: createAssetResolver's normalizeAssetKey
 *                  strips up to and including `assets/`, so cache entries
 *                  surface in the URL map under the same `img/...` keys as
 *                  flat-dir variants would.
 *
 * SVGs are originals but produce no jobs (no variant generation).
 * Files classified as 'variant' (leftover from the old pipeline) or 'ignore'
 * are skipped.
 */

import fs from 'node:fs';
import path from 'node:path';

import { classifyImageFile, FORMAT_OUTPUT_EXT } from './classifier.js';

export function* walkRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) yield full;
    }
  }
}

/**
 * @param {object} args
 * @param {string} args.siteImgDir - absolute path to site/assets/img/
 * @param {{ widths: number[], formats: string[] }} args.config
 * @returns {Array<{sourceKey: string, sourcePath: string, outputs: Array<{width: number, format: string, cacheRelPath: string}>}>}
 */
export function planVariantJobsFromFlatDir({ siteImgDir, config }) {
  if (!fs.existsSync(siteImgDir)) return [];

  const configWidths = new Set(config.widths);
  const jobs = [];

  for (const sourcePath of walkRecursive(siteImgDir)) {
    const relFromImg = path.relative(siteImgDir, sourcePath);

    if (relFromImg.split(path.sep)[0] === '_source') continue;

    const cls = classifyImageFile(relFromImg, configWidths);
    if (cls !== 'original') continue;

    const ext = path.extname(relFromImg).toLowerCase();
    if (ext === '.svg') continue;

    const parsed = path.parse(relFromImg);
    const subdir = parsed.dir;
    const baseName = parsed.name;

    const outputs = [];
    for (const width of config.widths) {
      for (const format of config.formats) {
        const outExt = FORMAT_OUTPUT_EXT[format];
        if (!outExt) continue;
        const variantName = `${baseName}-${width}.${outExt}`;
        const cacheRelPath = path.posix.join(
          'assets',
          'img',
          subdir.split(path.sep).join('/'),
          variantName,
        );
        outputs.push({ width, format, cacheRelPath });
      }
    }

    const sourceKey = path.posix.join(
      'img',
      relFromImg.split(path.sep).join('/'),
    );

    jobs.push({ sourceKey, sourcePath, outputs });
  }

  return jobs;
}
