import { STORAGE_KEYS, readStorage, writeStorage } from './webStorage.js';

const ATTRIBUTION = STORAGE_KEYS.attribution;
const SESSION_ID = STORAGE_KEYS.sessionId;

function generateSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function readStoredJson(entry, fallback = {}) {
  try {
    const raw = readStorage(entry.kind, entry.key, entry.legacy);
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { ...fallback, ...parsed };
    }
  } catch (error) {
    console.warn('[trackingContext] Failed to read storage key', entry.key, error);
  }
  return { ...fallback };
}

function writeStoredJson(entry, value) {
  writeStorage(entry.kind, entry.key, JSON.stringify(value));
}

function detectDeviceType(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (!ua) {
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
      return detectDeviceType(navigator.userAgent);
    }
    return 'unknown';
  }
  if (/tablet|ipad|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return 'mobile';
  return 'desktop';
}

function getViewportBucket() {
  if (typeof window === 'undefined') return 'unknown';
  const width = window.innerWidth || 0;
  if (width >= 1440) return 'xl';
  if (width >= 1024) return 'lg';
  if (width >= 768) return 'md';
  if (width > 0) return 'sm';
  return 'unknown';
}

function normalizeAttributionValue(value, fallback = 'unknown') {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

export function persistAttributionFromLocation() {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search || '');
  const stored = readStoredJson(ATTRIBUTION, {});

  const next = { ...stored };

  const utmSource = normalizeAttributionValue(params.get('utm_source'), stored.utm_source || 'direct');
  const utmMedium = normalizeAttributionValue(params.get('utm_medium'), stored.utm_medium || 'none');
  const utmCampaign = normalizeAttributionValue(params.get('utm_campaign'), stored.utm_campaign || '');
  const utmTerm = normalizeAttributionValue(params.get('utm_term'), stored.utm_term || '');
  const utmContent = normalizeAttributionValue(params.get('utm_content'), stored.utm_content || '');

  next.utm_source = utmSource;
  next.utm_medium = utmMedium;
  next.utm_campaign = utmCampaign;
  next.utm_term = utmTerm;
  next.utm_content = utmContent;

  if (!next.first_touch_timestamp) {
    next.first_touch_timestamp = Date.now();
  }

  if (!next.landing_path && window.location.pathname) {
    next.landing_path = window.location.pathname;
  }

  if (!next.referrer && document.referrer) {
    next.referrer = document.referrer;
  }

  writeStoredJson(ATTRIBUTION, next);

  if (!readStorage(SESSION_ID.kind, SESSION_ID.key, SESSION_ID.legacy)) {
    writeStorage(SESSION_ID.kind, SESSION_ID.key, generateSessionId());
  }
}

export function getAnalyticsContext(overrides = {}) {
  const attribution = readStoredJson(ATTRIBUTION, {
    utm_source: 'direct',
    utm_medium: 'none',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
    landing_path: typeof window !== 'undefined' ? window.location.pathname : '',
  });

  let sessionId = '';
  if (typeof window !== 'undefined') {
    sessionId =
      readStorage(SESSION_ID.kind, SESSION_ID.key, SESSION_ID.legacy) ||
      (() => {
        const fresh = generateSessionId();
        writeStorage(SESSION_ID.kind, SESSION_ID.key, fresh);
        return fresh;
      })();
  }

  const base = {
    utm_source: attribution.utm_source || 'direct',
    utm_medium: attribution.utm_medium || 'none',
    utm_campaign: attribution.utm_campaign || '',
    utm_term: attribution.utm_term || '',
    utm_content: attribution.utm_content || '',
    landing_path: attribution.landing_path || '',
    referrer: attribution.referrer || '',
    device_type: detectDeviceType(),
    viewport: getViewportBucket(),
    locale: (typeof document !== 'undefined' && document.documentElement?.lang) || '',
    session_id: sessionId,
    timestamp: Date.now(),
  };

  return { ...base, ...overrides };
}
