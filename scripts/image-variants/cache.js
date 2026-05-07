/**
 * Compute the per-site variant cache directory.
 *
 * Layout:
 *   {siteRoot}/node_modules/.cache/@koehler8/cms/image-variants/{siteKey}/
 *
 * where siteKey is the first 8 hex chars of sha1(siteDir). The keying
 * prevents cache collisions when @koehler8/cms is hoisted in a workspace
 * (one framework install serves multiple sites — without per-site keys,
 * concurrent builds would clobber each other).
 *
 * The cache lives under the SITE's node_modules (matching Vite's own
 * node_modules/.vite/ convention) so each site's cache is local to its
 * own project tree.
 */

import crypto from 'node:crypto';
import path from 'node:path';

export function siteKeyFor(siteDir) {
  return crypto
    .createHash('sha1')
    .update(path.resolve(siteDir))
    .digest('hex')
    .slice(0, 8);
}

export function computeVariantCacheDir(siteRoot, siteDir) {
  const root = path.resolve(siteRoot);
  const key = siteKeyFor(siteDir || siteRoot);
  return path.join(
    root,
    'node_modules',
    '.cache',
    '@koehler8',
    'cms',
    'image-variants',
    key,
  );
}
