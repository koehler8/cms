import { describe, it, expect } from 'vitest';
import {
  normalizeDraftPath,
  pathMatchesPrefix,
  isPathDraft,
  getDraftPasswordHash,
} from '../../src/utils/draftMode.js';

describe('normalizeDraftPath', () => {
  it('adds leading slash', () => {
    expect(normalizeDraftPath('about')).toBe('/about');
  });

  it('strips trailing slash', () => {
    expect(normalizeDraftPath('/about/')).toBe('/about');
    expect(normalizeDraftPath('/about///')).toBe('/about');
  });

  it('collapses multiple slashes', () => {
    expect(normalizeDraftPath('//hidden///nested')).toBe('/hidden/nested');
  });

  it('returns "/" for "/" input', () => {
    expect(normalizeDraftPath('/')).toBe('/');
  });

  it('returns null for empty / non-string input', () => {
    expect(normalizeDraftPath('')).toBe(null);
    expect(normalizeDraftPath('   ')).toBe(null);
    expect(normalizeDraftPath(null)).toBe(null);
    expect(normalizeDraftPath(undefined)).toBe(null);
    expect(normalizeDraftPath(42)).toBe(null);
  });
});

describe('pathMatchesPrefix', () => {
  it('exact match returns true', () => {
    expect(pathMatchesPrefix('/blog', '/blog')).toBe(true);
  });

  it('matches descendants on segment boundary', () => {
    expect(pathMatchesPrefix('/blog', '/blog/2026/post')).toBe(true);
    expect(pathMatchesPrefix('/blog', '/blog/welcome')).toBe(true);
  });

  it('does not match strings that share a prefix but cross segment boundary', () => {
    expect(pathMatchesPrefix('/blog', '/blog-archive')).toBe(false);
    expect(pathMatchesPrefix('/blog', '/blogs')).toBe(false);
  });

  it('handles trailing slash on either side', () => {
    expect(pathMatchesPrefix('/blog/', '/blog')).toBe(true);
    expect(pathMatchesPrefix('/blog', '/blog/')).toBe(true);
    expect(pathMatchesPrefix('/blog/', '/blog/2026/')).toBe(true);
  });

  it('case-sensitive', () => {
    expect(pathMatchesPrefix('/Blog', '/blog')).toBe(false);
  });

  it('"/" prefix matches only "/"', () => {
    expect(pathMatchesPrefix('/', '/')).toBe(true);
    expect(pathMatchesPrefix('/', '/blog')).toBe(false);
    expect(pathMatchesPrefix('/', '/anything')).toBe(false);
  });

  it('returns false for invalid input', () => {
    expect(pathMatchesPrefix('', '/blog')).toBe(false);
    expect(pathMatchesPrefix('/blog', '')).toBe(false);
    expect(pathMatchesPrefix(null, '/blog')).toBe(false);
  });
});

describe('isPathDraft', () => {
  it('returns false when no config', () => {
    expect(isPathDraft(null, '/about', null)).toBe(false);
    expect(isPathDraft({}, '/about', {})).toBe(false);
    expect(isPathDraft({ site: {} }, '/about', {})).toBe(false);
  });

  it('page-level draft:true wins even if site is published', () => {
    const site = { site: { draft: false, draftPaths: [] } };
    expect(isPathDraft(site, '/about', { draft: true })).toBe(true);
  });

  it('page-level draft:false wins even if site is draft', () => {
    const site = { site: { draft: true } };
    expect(isPathDraft(site, '/about', { draft: false })).toBe(false);
  });

  it('page-level draft:false overrides matching draftPaths', () => {
    const site = { site: { draftPaths: ['/blog'] } };
    expect(isPathDraft(site, '/blog/welcome', { draft: false })).toBe(false);
  });

  it('site.draft:true marks every path draft', () => {
    const site = { site: { draft: true } };
    expect(isPathDraft(site, '/', {})).toBe(true);
    expect(isPathDraft(site, '/about', {})).toBe(true);
    expect(isPathDraft(site, '/anything/deep', {})).toBe(true);
  });

  it('matching draftPaths marks path as draft', () => {
    const site = { site: { draftPaths: ['/hidden', '/blog/2026'] } };
    expect(isPathDraft(site, '/hidden', {})).toBe(true);
    expect(isPathDraft(site, '/hidden/nested', {})).toBe(true);
    expect(isPathDraft(site, '/blog/2026/post-1', {})).toBe(true);
  });

  it('non-matching paths are published', () => {
    const site = { site: { draftPaths: ['/hidden'] } };
    expect(isPathDraft(site, '/about', {})).toBe(false);
    expect(isPathDraft(site, '/hidden-archive', {})).toBe(false);
  });

  it('null/undefined pageData treated as no override', () => {
    const site = { site: { draft: true } };
    expect(isPathDraft(site, '/about', null)).toBe(true);
    expect(isPathDraft(site, '/about', undefined)).toBe(true);
  });

  it('non-boolean draft values are ignored', () => {
    const site = { site: { draft: false } };
    expect(isPathDraft(site, '/about', { draft: 'yes' })).toBe(false);
    expect(isPathDraft(site, '/about', { draft: 1 })).toBe(false);
  });
});

describe('getDraftPasswordHash', () => {
  it('returns empty string when missing', () => {
    expect(getDraftPasswordHash(null)).toBe('');
    expect(getDraftPasswordHash({})).toBe('');
    expect(getDraftPasswordHash({ site: {} })).toBe('');
  });

  it('returns trimmed and lowercased hash', () => {
    expect(getDraftPasswordHash({ site: { draftPasswordHash: '  ABCDEF  ' } })).toBe(
      'abcdef',
    );
  });

  it('returns empty string for non-string values', () => {
    expect(getDraftPasswordHash({ site: { draftPasswordHash: 42 } })).toBe('');
    expect(getDraftPasswordHash({ site: { draftPasswordHash: null } })).toBe('');
  });
});
