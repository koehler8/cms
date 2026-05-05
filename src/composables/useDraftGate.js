/**
 * Reactive gate state for draft pages.
 *
 * - During SSR (vite-ssg pre-render), isUnlocked is always false so the
 *   pre-rendered HTML on disk contains only the gate component, not the
 *   page body. Crawlers and `curl` see a noindex page with no content.
 * - In the browser, isUnlocked hydrates from sessionStorage so the gate
 *   doesn't re-prompt while the user iterates between draft pages within
 *   one tab. Closing the tab re-engages the gate (sessionStorage scope).
 * - Password verification is hash-based: the Vite plugin replaces
 *   site.draftPassword with site.draftPasswordHash (SHA-256 hex) at build
 *   time so the plaintext never lands in the bundle. attemptUnlock hashes
 *   the user's input with the same algorithm and compares.
 * - Empty/missing hash is a deliberate fail-safe state: the gate still
 *   appears, but accepts any input including empty. This makes the gate
 *   visible even when the author hasn't picked a password yet — see
 *   hasPassword in the return value.
 */

import { computed, ref } from 'vue';
import { isPathDraft, getDraftPasswordHash } from '../utils/draftMode.js';
import { sha256Hex } from '../utils/sha256.js';

const SESSION_KEY = 'cms_draft_unlocked';

function readUnlockedFromSession() {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function persistUnlocked() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* sessionStorage may be blocked in private mode; gate falls back to
       in-memory unlock for the lifetime of the page. */
  }
}

export function useDraftGate({ siteData, currentPage }) {
  const isDraft = computed(() => {
    const page = currentPage.value || {};
    return isPathDraft(siteData.value, page.path, page);
  });

  const expectedHash = computed(() => getDraftPasswordHash(siteData.value));
  const hasPassword = computed(() => expectedHash.value.length > 0);

  const isUnlocked = ref(import.meta.env.SSR ? false : readUnlockedFromSession());
  const errorMessage = ref('');

  async function attemptUnlock(input) {
    const hash = expectedHash.value;
    if (!hash) {
      isUnlocked.value = true;
      errorMessage.value = '';
      persistUnlocked();
      return true;
    }
    const provided = typeof input === 'string' ? input : '';
    let providedHash = '';
    try {
      providedHash = await sha256Hex(provided);
    } catch {
      providedHash = '';
    }
    if (providedHash && providedHash === hash) {
      isUnlocked.value = true;
      errorMessage.value = '';
      persistUnlocked();
      return true;
    }
    errorMessage.value = 'Incorrect password.';
    return false;
  }

  return {
    isDraft,
    isUnlocked,
    hasPassword,
    errorMessage,
    attemptUnlock,
  };
}
