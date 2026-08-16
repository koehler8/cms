import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  STORAGE_KEYS,
  readStorage,
  writeStorage,
  readStoredLocale,
  writeStoredLocale,
} from '../../src/utils/webStorage.js';

describe('webStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('every framework key is cms_-prefixed', () => {
    for (const entry of Object.values(STORAGE_KEYS)) {
      expect(entry.key.startsWith('cms_')).toBe(true);
      expect(entry.legacy.startsWith('cms_')).toBe(false);
    }
  });

  it('reads and writes the namespaced key', () => {
    expect(writeStorage('local', 'cms_test', 'v1')).toBe(true);
    expect(readStorage('local', 'cms_test')).toBe('v1');
    expect(localStorage.getItem('cms_test')).toBe('v1');
  });

  it('separates local and session kinds', () => {
    writeStorage('session', 'cms_test', 'sess');
    expect(sessionStorage.getItem('cms_test')).toBe('sess');
    expect(localStorage.getItem('cms_test')).toBeNull();
  });

  it('falls back to the legacy key and migrates it forward', () => {
    localStorage.setItem('old_key', 'legacy-value');
    expect(readStorage('local', 'cms_new_key', 'old_key')).toBe('legacy-value');
    // Migrated forward; legacy left in place for still-cached pre-1.0 bundles.
    expect(localStorage.getItem('cms_new_key')).toBe('legacy-value');
    expect(localStorage.getItem('old_key')).toBe('legacy-value');
  });

  it('prefers the namespaced key over the legacy key', () => {
    localStorage.setItem('cms_k', 'new');
    localStorage.setItem('k', 'old');
    expect(readStorage('local', 'cms_k', 'k')).toBe('new');
  });

  it('returns null / false instead of throwing when storage throws', () => {
    // Replace the whole localStorage accessor on window (happy-dom method
    // spies don't restore reliably); the property is configurable there.
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const denied = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: denied });
    try {
      expect(readStorage('local', 'cms_k', 'k')).toBeNull();
      expect(writeStorage('local', 'cms_k', 'v')).toBe(false);
    } finally {
      Object.defineProperty(window, 'localStorage', descriptor);
    }
    // Restored: normal access works again.
    expect(writeStorage('local', 'cms_restored', 'ok')).toBe(true);
    expect(localStorage.getItem('cms_restored')).toBe('ok');
  });

  it('locale convenience wrappers use cms_locale with legacy fallback', () => {
    localStorage.setItem('locale', 'de');
    expect(readStoredLocale()).toBe('de');
    expect(localStorage.getItem('cms_locale')).toBe('de');

    writeStoredLocale('fr');
    expect(localStorage.getItem('cms_locale')).toBe('fr');
    expect(readStoredLocale()).toBe('fr');
  });

  it('consent survives the pre-1.0 → 1.0 key rename (regression: a declined user must stay declined)', () => {
    localStorage.setItem('cookie_consent', 'declined');
    const entry = STORAGE_KEYS.consent;
    expect(readStorage(entry.kind, entry.key, entry.legacy)).toBe('declined');
    expect(localStorage.getItem('cms_cookie_consent')).toBe('declined');
  });
});
