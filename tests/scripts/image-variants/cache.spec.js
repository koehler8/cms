import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  siteKeyFor,
  computeVariantCacheDir,
} from '../../../scripts/image-variants/cache.js';

describe('siteKeyFor', () => {
  it('returns a stable 8-char hex key for the same input', () => {
    const a = siteKeyFor('/Users/chris/builder/site-foo');
    const b = siteKeyFor('/Users/chris/builder/site-foo');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns different keys for different sites', () => {
    const a = siteKeyFor('/Users/chris/builder/site-foo');
    const b = siteKeyFor('/Users/chris/builder/site-bar');
    expect(a).not.toBe(b);
  });

  it('normalizes relative paths to their absolute form', () => {
    const rel = siteKeyFor('./site-foo');
    const abs = siteKeyFor(path.resolve('./site-foo'));
    expect(rel).toBe(abs);
  });
});

describe('computeVariantCacheDir', () => {
  it('joins under siteRoot/node_modules/.cache/@koehler8/cms/image-variants/{key}', () => {
    const dir = computeVariantCacheDir('/projects/site-foo', '/projects/site-foo/site');
    expect(dir).toMatch(/\/projects\/site-foo\/node_modules\/\.cache\/@koehler8\/cms\/image-variants\/[0-9a-f]{8}$/);
  });

  it('uses siteDir for the key when provided distinctly from siteRoot', () => {
    const a = computeVariantCacheDir('/projects/repo', '/projects/repo/site-foo');
    const b = computeVariantCacheDir('/projects/repo', '/projects/repo/site-bar');
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(path.dirname(b));
  });

  it('falls back to siteRoot for the key when siteDir is not provided', () => {
    const a = computeVariantCacheDir('/projects/site-foo');
    const expected = computeVariantCacheDir('/projects/site-foo', '/projects/site-foo');
    expect(a).toBe(expected);
  });
});
