import { describe, it, expect } from 'vitest';
import { createAssetResolver } from '../../src/utils/assetResolver.js';

describe('createAssetResolver', () => {
  function makeResolver(shared = {}, site = {}) {
    return createAssetResolver(shared, site);
  }

  describe('asset key normalization', () => {
    it('strips path up to assets/', () => {
      const { resolveAssetUrl } = makeResolver({
        '/some/path/assets/img/logo.png': '/hashed/logo.abc.png',
      });
      expect(resolveAssetUrl('img/logo.png')).toBe('/hashed/logo.abc.png');
    });

    it('uses filename fallback when no assets/ segment', () => {
      const { resolveAssetUrl } = makeResolver({
        '/some/path/logo.png': '/hashed/logo.png',
      });
      expect(resolveAssetUrl('logo.png')).toBe('/hashed/logo.png');
    });
  });

  describe('site overrides shared', () => {
    it('site assets take priority over shared assets', () => {
      const { resolveAssetUrl } = makeResolver(
        { '/framework/assets/img/logo.png': '/shared/logo.png' },
        { '/site/assets/img/logo.png': '/site/logo.png' },
      );
      expect(resolveAssetUrl('img/logo.png')).toBe('/site/logo.png');
    });
  });

  describe('resolveAssetUrl', () => {
    it('returns URL for known path', () => {
      const { resolveAssetUrl } = makeResolver({
        '/assets/icon.svg': '/hashed/icon.svg',
      });
      expect(resolveAssetUrl('icon.svg')).toBe('/hashed/icon.svg');
    });

    it('returns empty string for unknown path', () => {
      const { resolveAssetUrl } = makeResolver({});
      expect(resolveAssetUrl('missing.png')).toBe('');
    });

    it('returns empty string for falsy input', () => {
      const { resolveAssetUrl } = makeResolver({});
      expect(resolveAssetUrl('')).toBe('');
      expect(resolveAssetUrl(null)).toBe('');
      expect(resolveAssetUrl(undefined)).toBe('');
    });

    it('strips leading slashes from path', () => {
      const { resolveAssetUrl } = makeResolver({
        '/assets/img/hero.jpg': '/hashed/hero.jpg',
      });
      expect(resolveAssetUrl('/img/hero.jpg')).toBe('/hashed/hero.jpg');
    });
  });

  describe('resolveAsset', () => {
    it('tries img/ prefix when not present', () => {
      const { resolveAsset } = makeResolver({
        '/assets/img/photo.jpg': '/hashed/photo.jpg',
      });
      expect(resolveAsset('photo.jpg')).toBe('/hashed/photo.jpg');
    });

    it('tries without img/ prefix when present', () => {
      const { resolveAsset } = makeResolver({
        '/assets/photo.jpg': '/hashed/photo.jpg',
      });
      expect(resolveAsset('img/photo.jpg')).toBe('/hashed/photo.jpg');
    });

    it('uses custom fallbacks', () => {
      const { resolveAsset } = makeResolver({
        '/assets/fallback.png': '/hashed/fallback.png',
      });
      expect(resolveAsset('missing.png', { fallbacks: ['fallback.png'] })).toBe('/hashed/fallback.png');
    });

    it('returns empty string when nothing resolves', () => {
      const { resolveAsset } = makeResolver({});
      expect(resolveAsset('nothing.jpg')).toBe('');
    });

    it('returns empty for falsy input', () => {
      const { resolveAsset } = makeResolver({});
      expect(resolveAsset('')).toBe('');
      expect(resolveAsset(null)).toBe('');
    });
  });

  describe('resolveMedia', () => {
    it('passes through HTTP URLs', () => {
      const { resolveMedia } = makeResolver({});
      expect(resolveMedia('https://example.com/img.png')).toBe('https://example.com/img.png');
      expect(resolveMedia('http://example.com/img.png')).toBe('http://example.com/img.png');
    });

    it('passes through data URIs', () => {
      const { resolveMedia } = makeResolver({});
      expect(resolveMedia('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    });

    it('passes through absolute paths', () => {
      const { resolveMedia } = makeResolver({});
      expect(resolveMedia('/absolute/path.png')).toBe('/absolute/path.png');
    });

    it('resolves relative paths through asset resolver', () => {
      const { resolveMedia } = makeResolver({
        '/assets/img/logo.png': '/hashed/logo.png',
      });
      expect(resolveMedia('logo.png')).toBe('/hashed/logo.png');
    });

    it('tries without leading segment for multi-segment paths', () => {
      const { resolveMedia } = makeResolver({
        '/assets/img/hero.jpg': '/hashed/hero.jpg',
      });
      expect(resolveMedia('images/hero.jpg')).toBe('/hashed/hero.jpg');
    });

    it('tries logos/ prefix', () => {
      const { resolveMedia } = makeResolver({
        '/assets/logos/brand.svg': '/hashed/brand.svg',
      });
      expect(resolveMedia('brand.svg')).toBe('/hashed/brand.svg');
    });

    it('returns original value when nothing resolves', () => {
      const { resolveMedia } = makeResolver({});
      expect(resolveMedia('unresolvable.png')).toBe('unresolvable.png');
    });

    it('returns empty for empty/whitespace input', () => {
      const { resolveMedia } = makeResolver({});
      expect(resolveMedia('')).toBe('');
      expect(resolveMedia('   ')).toBe('');
    });
  });

  describe('assetUrlMap', () => {
    it('exposes the internal map', () => {
      const { assetUrlMap } = makeResolver({
        '/assets/a.png': '/hashed/a.png',
        '/assets/b.png': '/hashed/b.png',
      });
      expect(assetUrlMap['a.png']).toBe('/hashed/a.png');
      expect(assetUrlMap['b.png']).toBe('/hashed/b.png');
    });
  });
});
