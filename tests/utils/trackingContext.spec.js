import { describe, it, expect, beforeEach, vi } from 'vitest';
import { persistAttributionFromLocation, getAnalyticsContext } from '../../src/utils/trackingContext.js';

describe('trackingContext', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('persistAttributionFromLocation', () => {
    it('stores UTM params from URL', () => {
      // Simulate URL with UTM params
      Object.defineProperty(window, 'location', {
        value: {
          search: '?utm_source=twitter&utm_medium=social&utm_campaign=launch',
          pathname: '/landing',
        },
        writable: true,
        configurable: true,
      });

      persistAttributionFromLocation();

      const stored = JSON.parse(sessionStorage.getItem('app_attribution_v1'));
      expect(stored.utm_source).toBe('twitter');
      expect(stored.utm_medium).toBe('social');
      expect(stored.utm_campaign).toBe('launch');
    });

    it('defaults utm_source to direct when not in URL', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '', pathname: '/' },
        writable: true,
        configurable: true,
      });

      persistAttributionFromLocation();

      const stored = JSON.parse(sessionStorage.getItem('app_attribution_v1'));
      expect(stored.utm_source).toBe('direct');
      expect(stored.utm_medium).toBe('none');
    });

    it('records landing_path on first call', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '', pathname: '/about' },
        writable: true,
        configurable: true,
      });

      persistAttributionFromLocation();

      const stored = JSON.parse(sessionStorage.getItem('app_attribution_v1'));
      expect(stored.landing_path).toBe('/about');
    });

    it('generates session ID', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '', pathname: '/' },
        writable: true,
        configurable: true,
      });

      persistAttributionFromLocation();

      const sessionId = sessionStorage.getItem('app_session_id');
      expect(sessionId).toBeTruthy();
    });

    it('does not overwrite first_touch_timestamp on subsequent calls', () => {
      Object.defineProperty(window, 'location', {
        value: { search: '', pathname: '/' },
        writable: true,
        configurable: true,
      });

      persistAttributionFromLocation();
      const stored1 = JSON.parse(sessionStorage.getItem('app_attribution_v1'));
      const firstTouch = stored1.first_touch_timestamp;

      persistAttributionFromLocation();
      const stored2 = JSON.parse(sessionStorage.getItem('app_attribution_v1'));
      expect(stored2.first_touch_timestamp).toBe(firstTouch);
    });
  });

  describe('getAnalyticsContext', () => {
    it('returns default values when no attribution stored', () => {
      const ctx = getAnalyticsContext();
      expect(ctx.utm_source).toBe('direct');
      expect(ctx.utm_medium).toBe('none');
      expect(ctx.device_type).toBeDefined();
      expect(ctx.viewport).toBeDefined();
      expect(ctx.session_id).toBeTruthy();
      expect(ctx.timestamp).toBeDefined();
    });

    it('applies overrides', () => {
      const ctx = getAnalyticsContext({ custom_key: 'value', utm_source: 'override' });
      expect(ctx.custom_key).toBe('value');
      expect(ctx.utm_source).toBe('override');
    });

    it('detects viewport bucket', () => {
      // happy-dom default innerWidth
      const ctx = getAnalyticsContext();
      expect(['xl', 'lg', 'md', 'sm', 'unknown']).toContain(ctx.viewport);
    });

    it('detects device type', () => {
      const ctx = getAnalyticsContext();
      expect(['desktop', 'mobile', 'tablet', 'unknown']).toContain(ctx.device_type);
    });

    it('generates session ID if not stored', () => {
      const ctx = getAnalyticsContext();
      expect(ctx.session_id).toBeTruthy();
      // Should persist it
      expect(sessionStorage.getItem('app_session_id')).toBe(ctx.session_id);
    });
  });
});
