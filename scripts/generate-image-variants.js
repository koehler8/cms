/**
 * Generate responsive image variants from `{siteDir}/assets/img/_source/**`
 * into `{siteDir}/assets/img/`.
 *
 * For each source image (jpg/jpeg/png/webp/avif/tiff), produces:
 *   {name}-{width}.avif
 *   {name}-{width}.webp
 *   {name}-{width}.jpg
 * across the configured widths. Subdirectory layout is preserved.
 *
 * Skips variants whose mtime is newer than the source's mtime — re-running
 * the script after a `git pull` only regenerates the images that changed.
 *
 * Configuration is read from `{siteDir}/content/{baseLocale}/site.json`'s
 * optional `imageVariants` block; defaults are sensible for marketing sites.
 *
 * Usage from a consuming site:
 *   CMS_SITE_DIR=./site node node_modules/@koehler8/cms/scripts/generate-image-variants.js
 *
 * Or via the CLI wrapper:
 *   npx cms-generate-image-variants --site-dir ./site
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { inflateFlatConfig } from '../src/utils/inflateFlatConfig.js';

// ---- Configuration ----

const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920, 2560];
const DEFAULT_FORMATS = ['avif', 'webp', 'jpg'];
const DEFAULT_QUALITY = { avif: 60, webp: 75, jpg: 80 };
const SOURCE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif']);

const FORMAT_OUTPUT_EXT = {
  avif: 'avif',
  webp: 'webp',
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
};

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function resolveSiteConfig(siteDir) {
  const contentDir = path.join(siteDir, 'content');
  const contentConfig = readJsonIfExists(path.join(contentDir, 'content.config.json')) || {};
  const baseLocale = contentConfig.baseLocale || 'en';
  const sitePath = path.join(contentDir, baseLocale, 'site.json');
  const raw = readJsonIfExists(sitePath) || {};
  return inflateFlatConfig(raw);
}

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

// Resolve `imageVariants` config block, with safe defaults.
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

// ---- File walking ----

function* walkSourceImages(sourceDir) {
  if (!fs.existsSync(sourceDir)) return;
  const stack = [sourceDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      yield full;
    }
  }
}

// Build the list of (sourcePath, outputs[]) jobs without doing IO yet.
export function planVariantJobs({ siteDir, config }) {
  const imgDir = path.join(siteDir, 'assets', 'img');
  const sourceDir = path.join(imgDir, '_source');
  const jobs = [];
  if (!fs.existsSync(sourceDir)) return jobs;

  for (const sourcePath of walkSourceImages(sourceDir)) {
    const relFromSource = path.relative(sourceDir, sourcePath);
    const parsed = path.parse(relFromSource);
    const subdir = parsed.dir;
    const baseName = parsed.name;

    const outputs = [];
    for (const width of config.widths) {
      for (const format of config.formats) {
        const ext = FORMAT_OUTPUT_EXT[format];
        if (!ext) continue;
        const outName = `${baseName}-${width}.${ext}`;
        const outPath = path.join(imgDir, subdir, outName);
        outputs.push({ width, format, outPath });
      }
    }
    jobs.push({ sourcePath, outputs });
  }
  return jobs;
}

// Apply a per-output sharp transform pipeline.
async function renderOutput(sourcePath, output, config) {
  const { width, format, outPath } = output;
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

  let pipeline = sharp(sourcePath, { failOn: 'truncated' }).rotate();
  pipeline = pipeline.resize({ width, withoutEnlargement: true });
  switch (format) {
    case 'avif':
      pipeline = pipeline.avif({ quality: config.quality.avif });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: config.quality.webp });
      break;
    case 'jpg':
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality: config.quality.jpg, mozjpeg: true });
      break;
    case 'png':
      pipeline = pipeline.png();
      break;
    default:
      throw new Error(`unsupported format: ${format}`);
  }
  await pipeline.toFile(outPath);
}

function isUpToDate(sourcePath, outPath) {
  if (!fs.existsSync(outPath)) return false;
  try {
    const src = fs.statSync(sourcePath).mtimeMs;
    const dst = fs.statSync(outPath).mtimeMs;
    return dst >= src;
  } catch {
    return false;
  }
}

// ---- Main ----

export async function generateVariants({ siteDir, log = console.log, warn = console.warn } = {}) {
  if (!siteDir || !fs.existsSync(siteDir)) {
    throw new Error(`siteDir does not exist: ${siteDir}`);
  }
  const siteConfig = resolveSiteConfig(siteDir);
  const config = resolveImageVariantConfig(siteConfig);
  const jobs = planVariantJobs({ siteDir, config });
  if (jobs.length === 0) {
    log(`[cms-image-variants] no sources found under ${path.join(siteDir, 'assets', 'img', '_source')}`);
    return { generated: 0, skipped: 0, sources: 0 };
  }

  let generated = 0;
  let skipped = 0;
  for (const { sourcePath, outputs } of jobs) {
    for (const output of outputs) {
      if (isUpToDate(sourcePath, output.outPath)) {
        skipped += 1;
        continue;
      }
      try {
        await renderOutput(sourcePath, output, config);
        generated += 1;
      } catch (err) {
        warn(`[cms-image-variants] failed ${path.relative(siteDir, output.outPath)}: ${err.message}`);
      }
    }
  }
  log(
    `[cms-image-variants] sources: ${jobs.length}, generated: ${generated}, skipped (up-to-date): ${skipped}`,
  );
  return { generated, skipped, sources: jobs.length };
}

// Allow invocation as `node scripts/generate-image-variants.js` (used by the
// bin wrapper). Reads CMS_SITE_DIR like generate-public-assets does.
const isMain = (() => {
  try {
    const __filename = new URL(import.meta.url).pathname;
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
  } catch {
    return false;
  }
})();

if (isMain) {
  const siteDir = process.env.CMS_SITE_DIR
    ? path.resolve(process.env.CMS_SITE_DIR)
    : null;
  if (!siteDir) {
    console.error('❌ CMS_SITE_DIR environment variable is required.');
    console.error('   Example: CMS_SITE_DIR=./site npx cms-generate-image-variants');
    process.exit(1);
  }
  generateVariants({ siteDir }).catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
