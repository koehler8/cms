/**
 * Cache manifest: persisted record of what's in the variant cache directory.
 *
 * Format:
 *   {
 *     version: 1,
 *     config:  { widths, formats, quality },
 *     sources: {
 *       "img/logo.png": { mtimeMs, variants: ["assets/img/logo-320.webp", ...] },
 *       ...
 *     }
 *   }
 *
 * Used by reconcileVariantCache to:
 *   - Skip regeneration when source mtime is unchanged AND config matches.
 *   - Detect orphaned entries (source removed) and delete their cached files.
 *   - Force a full regen when config changes (e.g. user added a new width).
 */

import fs from 'node:fs';

export const MANIFEST_VERSION = 1;

export function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (parsed && parsed.version === MANIFEST_VERSION) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function writeManifest(manifestPath, manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Deep equality check for image-variant config blocks. Returns true when
 * widths, formats, and quality (per-format) all match. Order-insensitive
 * for arrays.
 */
export function configsEqual(a, b) {
  if (!a || !b) return false;
  if (!arraysEqualUnordered(a.widths, b.widths)) return false;
  if (!arraysEqualUnordered(a.formats, b.formats)) return false;
  return objectsEqual(a.quality, b.quality);
}

function arraysEqualUnordered(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

function objectsEqual(a, b) {
  if (!a || !b) return a === b;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
