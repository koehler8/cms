/**
 * Public API for the image-variant pipeline.
 *
 * Used by:
 *   - The Vite plugin (vite-plugin.js) — buildStart hook + dev watcher.
 *   - The migration helper (scripts/migrate-image-variants.mjs) — reads
 *     `_source/` presence to know whether to migrate.
 *
 * The pipeline runs at build/dev time, generates variants to
 * node_modules/.cache/@koehler8/cms/image-variants/{siteKey}/, and never
 * touches the site's source tree.
 */

export { resolveImageVariantConfig, DEFAULT_WIDTHS, DEFAULT_FORMATS, DEFAULT_QUALITY } from './config.js';
export { classifyImageFile, SOURCE_EXTENSIONS, FORMAT_OUTPUT_EXT } from './classifier.js';
export { planVariantJobsFromFlatDir, walkRecursive } from './planner.js';
export { renderOutput } from './renderer.js';
export { readManifest, writeManifest, configsEqual, MANIFEST_VERSION } from './manifest.js';
export { computeVariantCacheDir, siteKeyFor } from './cache.js';
export { reconcileVariantCache } from './reconcile.js';
