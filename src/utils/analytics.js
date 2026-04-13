/**
 * Lightweight Google Analytics helper that respects consent settings.
 */
import { shouldEnableAnalytics } from './cookieConsent.js';
import { getAnalyticsContext } from './trackingContext.js';

const SENSITIVE_KEYS = new Set(['wallet_address', 'account_address', 'private_key', 'seed_phrase']);

function sanitizeParams(params = {}) {
  if (!params || typeof params !== 'object') return {};
  return Object.entries(params).reduce((acc, [key, value]) => {
    const lowered = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowered)) {
      return acc;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      acc[key] = sanitizeParams(value);
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
}

function canTrack() {
  if (typeof window === 'undefined') return false;
  if (!shouldEnableAnalytics()) return false;
  if (typeof window.gtag !== 'function') return false;
  return true;
}

/**
 * Send a GA4 event if analytics is ready.
 * @param {string} name - GA4 event name.
 * @param {Record<string, any>} [params] - Additional event parameters.
 * @returns {boolean} True when the call was sent to gtag.
 */
export function trackEvent(name, params = {}) {
  if (!name || typeof name !== 'string') {
    if (import.meta.env.DEV) {
      console.warn('[analytics] trackEvent requires a string name.');
    }
    return false;
  }

  if (!canTrack()) return false;

  try {
    const payload = sanitizeParams(params);
    window.gtag('event', name, payload);
    return true;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[analytics] Failed to send event', name, error);
    }
    return false;
  }
}

/**
 * Set GA4 user properties.
 * @param {Record<string, any>} properties
 * @returns {boolean}
 */
export function setUserProperties(properties = {}) {
  if (!properties || typeof properties !== 'object') return false;
  if (!canTrack()) return false;
  try {
    window.gtag('set', 'user_properties', properties);
    return true;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[analytics] Failed to set user_properties', error);
    }
    return false;
  }
}

/**
 * Public helper to surface readiness in components if needed.
 * @returns {boolean}
 */
export function isAnalyticsReady() {
  return canTrack();
}

/**
 * Alias kept for ergonomic imports in components.
 */
export function trackEventIfReady(name, params) {
  return trackEvent(name, params);
}

export function trackFunnelEvent(name, params = {}) {
  const payload = {
    ...getAnalyticsContext(),
    ...sanitizeParams(params),
  };
  return trackEvent(name, payload);
}
