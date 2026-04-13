import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock cookieConsent and trackingContext before importing analytics
vi.mock('../../src/utils/cookieConsent.js', () => ({
  shouldEnableAnalytics: vi.fn(() => true),
}));

vi.mock('../../src/utils/trackingContext.js', () => ({
  getAnalyticsContext: vi.fn(() => ({
    utm_source: 'test',
    session_id: 'test-session',
  })),
}));

const { trackEvent, setUserProperties, isAnalyticsReady, trackFunnelEvent } = await import(
  '../../src/utils/analytics.js'
);
const { shouldEnableAnalytics } = await import('../../src/utils/cookieConsent.js');
const { getAnalyticsContext } = await import('../../src/utils/trackingContext.js');

describe('analytics', () => {
  let mockGtag;

  beforeEach(() => {
    mockGtag = vi.fn();
    window.gtag = mockGtag;
    shouldEnableAnalytics.mockReturnValue(true);
  });

  afterEach(() => {
    delete window.gtag;
    vi.restoreAllMocks();
  });

  describe('trackEvent', () => {
    it('sends event to gtag', () => {
      const result = trackEvent('test_event', { key: 'value' });
      expect(result).toBe(true);
      expect(mockGtag).toHaveBeenCalledWith('event', 'test_event', { key: 'value' });
    });

    it('returns false when name is missing', () => {
      expect(trackEvent('')).toBe(false);
      expect(trackEvent(null)).toBe(false);
    });

    it('returns false when consent not given', () => {
      shouldEnableAnalytics.mockReturnValue(false);
      expect(trackEvent('test')).toBe(false);
    });

    it('returns false when gtag not available', () => {
      delete window.gtag;
      expect(trackEvent('test')).toBe(false);
    });

    it('sanitizes sensitive keys from params', () => {
      trackEvent('test', {
        safe_key: 'ok',
        wallet_address: '0x123',
        private_key: 'secret',
        seed_phrase: 'words',
        account_address: 'addr',
      });
      const payload = mockGtag.mock.calls[0][2];
      expect(payload.safe_key).toBe('ok');
      expect(payload.wallet_address).toBeUndefined();
      expect(payload.private_key).toBeUndefined();
      expect(payload.seed_phrase).toBeUndefined();
      expect(payload.account_address).toBeUndefined();
    });

    it('sanitizes nested objects recursively', () => {
      trackEvent('test', {
        nested: { wallet_address: '0x123', ok: 'fine' },
      });
      const payload = mockGtag.mock.calls[0][2];
      expect(payload.nested.ok).toBe('fine');
      expect(payload.nested.wallet_address).toBeUndefined();
    });
  });

  describe('setUserProperties', () => {
    it('sends user properties to gtag', () => {
      const result = setUserProperties({ plan: 'pro' });
      expect(result).toBe(true);
      expect(mockGtag).toHaveBeenCalledWith('set', 'user_properties', { plan: 'pro' });
    });

    it('returns false for non-object input', () => {
      expect(setUserProperties(null)).toBe(false);
    });
  });

  describe('isAnalyticsReady', () => {
    it('returns true when consent and gtag are available', () => {
      expect(isAnalyticsReady()).toBe(true);
    });

    it('returns false when consent is denied', () => {
      shouldEnableAnalytics.mockReturnValue(false);
      expect(isAnalyticsReady()).toBe(false);
    });
  });

  describe('trackFunnelEvent', () => {
    it('merges analytics context with params', () => {
      trackFunnelEvent('funnel_step', { step: 1 });
      const payload = mockGtag.mock.calls[0][2];
      expect(payload.utm_source).toBe('test');
      expect(payload.session_id).toBe('test-session');
      expect(payload.step).toBe(1);
    });
  });
});
