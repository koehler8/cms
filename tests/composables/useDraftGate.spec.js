import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { ref } from 'vue';
import { useDraftGate } from '../../src/composables/useDraftGate.js';
import { sha256Hex } from '../../src/utils/sha256.js';

const SESSION_KEY = 'cms_draft_unlocked';
let SECRET_HASH;

function setup({ site = {}, page = { path: '/' } } = {}) {
  const siteData = ref({ site });
  const currentPage = ref(page);
  return { ...useDraftGate({ siteData, currentPage }), siteData, currentPage };
}

beforeAll(async () => {
  SECRET_HASH = await sha256Hex('secret');
});

beforeEach(() => {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.clear();
  }
});

describe('useDraftGate — isDraft', () => {
  it('false when nothing is draft', () => {
    const { isDraft } = setup();
    expect(isDraft.value).toBe(false);
  });

  it('true when site.draft is true', () => {
    const { isDraft } = setup({ site: { draft: true } });
    expect(isDraft.value).toBe(true);
  });

  it('true when current page draft is true', () => {
    const { isDraft } = setup({ page: { path: '/wip', draft: true } });
    expect(isDraft.value).toBe(true);
  });

  it('true when path matches draftPaths prefix', () => {
    const { isDraft } = setup({
      site: { draftPaths: ['/blog/2026'] },
      page: { path: '/blog/2026/post' },
    });
    expect(isDraft.value).toBe(true);
  });

  it('reactively updates when currentPage changes', () => {
    const { isDraft, currentPage } = setup({ page: { path: '/about' } });
    expect(isDraft.value).toBe(false);
    currentPage.value = { path: '/wip', draft: true };
    expect(isDraft.value).toBe(true);
  });
});

describe('useDraftGate — hasPassword', () => {
  it('false when no draftPasswordHash set', () => {
    const { hasPassword } = setup();
    expect(hasPassword.value).toBe(false);
  });

  it('false for empty hash', () => {
    const { hasPassword } = setup({ site: { draftPasswordHash: '' } });
    expect(hasPassword.value).toBe(false);
  });

  it('true when hash is set', () => {
    const { hasPassword } = setup({ site: { draftPasswordHash: SECRET_HASH } });
    expect(hasPassword.value).toBe(true);
  });
});

describe('useDraftGate — attemptUnlock', () => {
  it('correct password unlocks', async () => {
    const { isUnlocked, attemptUnlock, errorMessage } = setup({
      site: { draftPasswordHash: SECRET_HASH },
    });
    await expect(attemptUnlock('secret')).resolves.toBe(true);
    expect(isUnlocked.value).toBe(true);
    expect(errorMessage.value).toBe('');
  });

  it('wrong password does not unlock and sets error', async () => {
    const { isUnlocked, attemptUnlock, errorMessage } = setup({
      site: { draftPasswordHash: SECRET_HASH },
    });
    await expect(attemptUnlock('nope')).resolves.toBe(false);
    expect(isUnlocked.value).toBe(false);
    expect(errorMessage.value).toBe('Incorrect password.');
  });

  it('empty input fails when password is set', async () => {
    const { isUnlocked, attemptUnlock } = setup({ site: { draftPasswordHash: SECRET_HASH } });
    await expect(attemptUnlock('')).resolves.toBe(false);
    expect(isUnlocked.value).toBe(false);
  });

  it('any input unlocks when no password is configured', async () => {
    const { isUnlocked, attemptUnlock } = setup();
    await expect(attemptUnlock('')).resolves.toBe(true);
    expect(isUnlocked.value).toBe(true);
  });

  it('any input unlocks when hash is empty', async () => {
    const { isUnlocked, attemptUnlock } = setup({
      site: { draftPasswordHash: '' },
    });
    await expect(attemptUnlock('whatever')).resolves.toBe(true);
    expect(isUnlocked.value).toBe(true);
  });

  it('persists unlock to sessionStorage on success', async () => {
    await setup({ site: { draftPasswordHash: SECRET_HASH } }).attemptUnlock('secret');
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe('1');
  });

  it('does not persist on failed unlock', async () => {
    await setup({ site: { draftPasswordHash: SECRET_HASH } }).attemptUnlock('wrong');
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('hydrates isUnlocked from sessionStorage at construction', () => {
    window.sessionStorage.setItem(SESSION_KEY, '1');
    const { isUnlocked } = setup({ site: { draftPasswordHash: SECRET_HASH } });
    expect(isUnlocked.value).toBe(true);
  });

  it('non-string input is treated as empty', async () => {
    const { attemptUnlock } = setup({ site: { draftPasswordHash: SECRET_HASH } });
    await expect(attemptUnlock(null)).resolves.toBe(false);
    await expect(attemptUnlock(undefined)).resolves.toBe(false);
    await expect(attemptUnlock(42)).resolves.toBe(false);
  });

  it('hash comparison is case-insensitive (paranoia)', async () => {
    const upperHash = SECRET_HASH.toUpperCase();
    const { attemptUnlock, isUnlocked } = setup({
      site: { draftPasswordHash: upperHash },
    });
    await expect(attemptUnlock('secret')).resolves.toBe(true);
    expect(isUnlocked.value).toBe(true);
  });
});
