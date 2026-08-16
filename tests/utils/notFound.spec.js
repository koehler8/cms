import { describe, it, expect } from 'vitest';

import {
  isNotFoundPage,
  normalizeNotFoundPath,
  NOT_FOUND_PAGE_ID,
  NOT_FOUND_PATH,
} from '../../src/utils/notFound.js';

describe('notFound — shared not-found page detection', () => {
  it('exposes the reserved id and path', () => {
    expect(NOT_FOUND_PAGE_ID).toBe('404');
    expect(NOT_FOUND_PATH).toBe('/404');
  });

  describe('normalizeNotFoundPath', () => {
    it('normalizes leading slash, duplicate slashes, and trailing slash', () => {
      expect(normalizeNotFoundPath('404')).toBe('/404');
      expect(normalizeNotFoundPath('/404')).toBe('/404');
      expect(normalizeNotFoundPath('/404/')).toBe('/404');
      expect(normalizeNotFoundPath('//404//')).toBe('/404');
      expect(normalizeNotFoundPath('  /404  ')).toBe('/404');
    });

    it('returns "/" for empty or non-string input', () => {
      expect(normalizeNotFoundPath('')).toBe('/');
      expect(normalizeNotFoundPath('   ')).toBe('/');
      expect(normalizeNotFoundPath(null)).toBe('/');
      expect(normalizeNotFoundPath(undefined)).toBe('/');
      expect(normalizeNotFoundPath(404)).toBe('/');
    });
  });

  describe('isNotFoundPage', () => {
    it('matches by reserved page id', () => {
      expect(isNotFoundPage('404', '/anything')).toBe(true);
    });

    it('matches by path even when the file is named something else', () => {
      expect(isNotFoundPage('not-found', '/404')).toBe(true);
      expect(isNotFoundPage('missing', '/404/')).toBe(true);
    });

    it('does not match ordinary pages', () => {
      expect(isNotFoundPage('home', '/')).toBe(false);
      expect(isNotFoundPage('about', '/about')).toBe(false);
      // Guard against a prefix match swallowing a real content page.
      expect(isNotFoundPage('report', '/404-report')).toBe(false);
      expect(isNotFoundPage('errors', '/errors/404')).toBe(false);
    });
  });
});
