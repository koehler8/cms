/**
 * Cookie Consent Management Utility
 * Handles storing and retrieving user consent for analytics tracking
 */

const CONSENT_KEY = 'cookie_consent';
const CONSENT_TIMESTAMP_KEY = 'cookie_consent_timestamp';
const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const ConsentStatus = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  PENDING: 'pending'
};

function parseEnvFlag(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return false;
  }

  if (typeof rawValue === 'boolean') {
    return rawValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === '') {
    return false;
  }

  return TRUTHY_ENV_VALUES.has(normalized);
}

export function isCookieBannerEnabled() {
  return parseEnvFlag(import.meta.env.VITE_SHOW_COOKIE_BANNER);
}

/**
 * Get the current consent status
 * @returns {string} One of ConsentStatus values
 */
export function getConsentStatus() {
  try {
    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === ConsentStatus.ACCEPTED || consent === ConsentStatus.DECLINED) {
      return consent;
    }
    return ConsentStatus.PENDING;
  } catch (error) {
    console.warn('Unable to access localStorage for consent:', error);
    return ConsentStatus.PENDING;
  }
}

/**
 * Set the user's consent status
 * @param {string} status - One of ConsentStatus values
 */
export function setConsentStatus(status) {
  try {
    localStorage.setItem(CONSENT_KEY, status);
    localStorage.setItem(CONSENT_TIMESTAMP_KEY, new Date().toISOString());
    
    // Trigger custom event for other parts of the app to react
    window.dispatchEvent(new CustomEvent('consentChanged', { detail: { status } }));
  } catch (error) {
    console.error('Unable to save consent status:', error);
  }
}

/**
 * Accept cookies and analytics tracking
 */
export function acceptConsent() {
  setConsentStatus(ConsentStatus.ACCEPTED);
}

/**
 * Decline cookies and analytics tracking
 */
export function declineConsent() {
  setConsentStatus(ConsentStatus.DECLINED);
}

/**
 * Revoke previously given consent (records as declined)
 */
export function revokeConsent() {
  declineConsent();
}

/**
 * Check if user has accepted consent
 * @returns {boolean}
 */
export function hasAcceptedConsent() {
  return getConsentStatus() === ConsentStatus.ACCEPTED;
}

/**
 * Check if user has declined consent
 * @returns {boolean}
 */
export function hasDeclinedConsent() {
  return getConsentStatus() === ConsentStatus.DECLINED;
}

/**
 * Check if consent is still pending
 * @returns {boolean}
 */
export function isConsentPending() {
  return getConsentStatus() === ConsentStatus.PENDING;
}

/**
 * Determine if analytics should be active.
 * Pending consent defaults to enabled so tracking starts immediately.
 *
 * NOTE: In EU/EEA jurisdictions, GDPR and the ePrivacy Directive require
 * affirmative consent before setting non-essential cookies or loading
 * tracking scripts. If the site targets EU users, consider changing the
 * PENDING case to return false so analytics remain disabled until the
 * user explicitly accepts.
 *
 * @returns {boolean}
 */
export function shouldEnableAnalytics() {
  const status = getConsentStatus();
  return status === ConsentStatus.ACCEPTED || status === ConsentStatus.PENDING;
}

let analyticsLoadPromise;

function appendAnalyticsScript(googleId) {
  if (!googleId) return;
  if (window.gtag) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${googleId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', googleId);
}

/**
 * Load Google Analytics if consent is granted
 */
export function loadGoogleAnalytics(googleId) {
  if (!googleId || typeof window === 'undefined') {
    return;
  }

  if (!shouldEnableAnalytics()) {
    return;
  }

  appendAnalyticsScript(googleId);
}

function whenHeroIsVisible(selector, callback, timeout = 4000) {
  if (typeof window === 'undefined') {
    callback();
    return;
  }

  const targets = Array.from(document.querySelectorAll(selector)).filter(Boolean);
  if (!targets.length || !('IntersectionObserver' in window)) {
    callback();
    return;
  }

  let resolved = false;
  const resolve = () => {
    if (resolved) return;
    resolved = true;
    observer.disconnect();
    callback();
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        resolve();
      }
    },
    {
      rootMargin: '0px',
      threshold: 0.1,
    }
  );

  targets.forEach((target) => observer.observe(target));

  window.setTimeout(resolve, timeout);
}

function deferUntilIdle(callback, timeout = 2000) {
  if (typeof window === 'undefined') {
    callback();
    return;
  }

  const run = () => {
    try {
      callback();
    } catch (error) {
      console.error('Deferred analytics load failed:', error);
    }
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout });
  } else {
    window.setTimeout(run, timeout);
  }
}

/**
 * Defer analytics loading until the main content is visible (or idle timeout).
 * @param {string} googleId
 * @param {object} [options]
 * @param {string} [options.selector='#promo, main']
 * @param {number} [options.visibilityTimeout=4000]
 * @param {number} [options.idleTimeout=2000]
 * @returns {Promise<void>}
 */
export function scheduleAnalyticsLoad(googleId, options = {}) {
  if (!googleId || typeof window === 'undefined') {
    return Promise.resolve();
  }

  if (!shouldEnableAnalytics()) {
    return Promise.resolve();
  }

  if (window.gtag) {
    return Promise.resolve();
  }

  if (analyticsLoadPromise) {
    return analyticsLoadPromise;
  }

  const {
    selector = '#promo, main',
    visibilityTimeout = 4000,
    idleTimeout = 2000,
  } = options;

  analyticsLoadPromise = new Promise((resolve) => {
    const triggerLoad = () => {
      if (window.gtag) {
        resolve();
        return;
      }
      appendAnalyticsScript(googleId);
      resolve();
    };

    const startObservation = () => {
      whenHeroIsVisible(selector, () => {
        deferUntilIdle(triggerLoad, idleTimeout);
      }, visibilityTimeout);
    };

    if (document.readyState === 'complete') {
      startObservation();
    } else {
      window.addEventListener('load', startObservation, { once: true });
    }
  });

  return analyticsLoadPromise;
}
