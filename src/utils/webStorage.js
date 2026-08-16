/**
 * Namespaced, guarded browser-storage access for framework state.
 *
 * All framework keys carry the `cms_` prefix so they cannot collide with
 * site-author or extension keys on the same origin (the bare `locale` key in
 * particular was a likely collision). Reads fall back to the pre-1.0
 * unprefixed key and migrate the value forward, so returning visitors keep
 * their consent choice and locale preference across the rename; the legacy
 * key is left in place (harmless, and keeps still-cached pre-1.0 bundles
 * working during a deploy window).
 *
 * Every access is guarded: Safari private mode and blocked-storage contexts
 * throw on touch, and a storage failure must degrade to "no stored value" —
 * never break the page.
 */

export const STORAGE_KEYS = {
  locale: { kind: 'local', key: 'cms_locale', legacy: 'locale' },
  consent: { kind: 'local', key: 'cms_cookie_consent', legacy: 'cookie_consent' },
  consentTimestamp: { kind: 'local', key: 'cms_cookie_consent_timestamp', legacy: 'cookie_consent_timestamp' },
  sessionId: { kind: 'session', key: 'cms_session_id', legacy: 'app_session_id' },
  attribution: { kind: 'session', key: 'cms_attribution_v1', legacy: 'app_attribution_v1' },
};

function getStore(kind) {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read a value. Falls back to `legacyKey` (migrating it forward) when the
 * namespaced key is empty. Returns null when unavailable.
 */
export function readStorage(kind, key, legacyKey = '') {
  const store = getStore(kind);
  if (!store) return null;
  try {
    const value = store.getItem(key);
    if (value !== null && value !== undefined) return value;
    if (legacyKey) {
      const legacy = store.getItem(legacyKey);
      if (legacy !== null && legacy !== undefined) {
        try {
          store.setItem(key, legacy);
        } catch {
          /* migration is best-effort */
        }
        return legacy;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Write a value. Returns false (never throws) when storage is unavailable. */
export function writeStorage(kind, key, value) {
  const store = getStore(kind);
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Convenience wrappers for the shared locale preference. */
export function readStoredLocale() {
  const { kind, key, legacy } = STORAGE_KEYS.locale;
  return readStorage(kind, key, legacy);
}

export function writeStoredLocale(value) {
  const { kind, key } = STORAGE_KEYS.locale;
  return writeStorage(kind, key, value);
}
