import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConsentStatus,
  getConsentStatus,
  setConsentStatus,
  acceptConsent,
  declineConsent,
  revokeConsent,
  hasAcceptedConsent,
  hasDeclinedConsent,
  isConsentPending,
  shouldEnableAnalytics,
} from '../../src/utils/cookieConsent.js';

describe('cookieConsent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('ConsentStatus enum', () => {
    it('has expected values', () => {
      expect(ConsentStatus.ACCEPTED).toBe('accepted');
      expect(ConsentStatus.DECLINED).toBe('declined');
      expect(ConsentStatus.PENDING).toBe('pending');
    });
  });

  describe('getConsentStatus', () => {
    it('returns PENDING when no consent stored', () => {
      expect(getConsentStatus()).toBe(ConsentStatus.PENDING);
    });

    it('returns ACCEPTED when stored', () => {
      localStorage.setItem('cookie_consent', 'accepted');
      expect(getConsentStatus()).toBe(ConsentStatus.ACCEPTED);
    });

    it('returns DECLINED when stored', () => {
      localStorage.setItem('cookie_consent', 'declined');
      expect(getConsentStatus()).toBe(ConsentStatus.DECLINED);
    });

    it('returns PENDING for unknown values', () => {
      localStorage.setItem('cookie_consent', 'invalid');
      expect(getConsentStatus()).toBe(ConsentStatus.PENDING);
    });
  });

  describe('setConsentStatus', () => {
    it('stores status in localStorage', () => {
      setConsentStatus(ConsentStatus.ACCEPTED);
      expect(localStorage.getItem('cookie_consent')).toBe('accepted');
    });

    it('stores timestamp', () => {
      setConsentStatus(ConsentStatus.ACCEPTED);
      const timestamp = localStorage.getItem('cookie_consent_timestamp');
      expect(timestamp).toBeTruthy();
      expect(new Date(timestamp).getTime()).not.toBeNaN();
    });

    it('dispatches consentChanged event', () => {
      const handler = vi.fn();
      window.addEventListener('consentChanged', handler);
      setConsentStatus(ConsentStatus.ACCEPTED);
      window.removeEventListener('consentChanged', handler);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].detail.status).toBe('accepted');
    });
  });

  describe('acceptConsent', () => {
    it('sets status to ACCEPTED', () => {
      acceptConsent();
      expect(getConsentStatus()).toBe(ConsentStatus.ACCEPTED);
    });
  });

  describe('declineConsent', () => {
    it('sets status to DECLINED', () => {
      declineConsent();
      expect(getConsentStatus()).toBe(ConsentStatus.DECLINED);
    });
  });

  describe('revokeConsent', () => {
    it('records as DECLINED', () => {
      acceptConsent();
      revokeConsent();
      expect(getConsentStatus()).toBe(ConsentStatus.DECLINED);
    });
  });

  describe('convenience boolean helpers', () => {
    it('hasAcceptedConsent', () => {
      acceptConsent();
      expect(hasAcceptedConsent()).toBe(true);
      expect(hasDeclinedConsent()).toBe(false);
      expect(isConsentPending()).toBe(false);
    });

    it('hasDeclinedConsent', () => {
      declineConsent();
      expect(hasDeclinedConsent()).toBe(true);
      expect(hasAcceptedConsent()).toBe(false);
    });

    it('isConsentPending', () => {
      expect(isConsentPending()).toBe(true);
    });
  });

  describe('shouldEnableAnalytics', () => {
    it('returns true when accepted', () => {
      acceptConsent();
      expect(shouldEnableAnalytics()).toBe(true);
    });

    it('returns true when pending (default-on)', () => {
      expect(shouldEnableAnalytics()).toBe(true);
    });

    it('returns false when declined', () => {
      declineConsent();
      expect(shouldEnableAnalytics()).toBe(false);
    });
  });
});
