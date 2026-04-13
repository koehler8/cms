import { describe, it, expect } from 'vitest';
import { useComingSoonInterstitial } from '../../src/composables/useComingSoonInterstitial.js';

describe('useComingSoonInterstitial', () => {
  it('starts with modal hidden', () => {
    const { isComingSoonVisible } = useComingSoonInterstitial();
    expect(isComingSoonVisible.value).toBe(false);
  });

  it('opens modal with custom title and message', () => {
    const { openComingSoon, isComingSoonVisible, comingSoonTitle, comingSoonMessage } =
      useComingSoonInterstitial();

    openComingSoon({ title: 'Test Title', message: 'Test Message' });

    expect(isComingSoonVisible.value).toBe(true);
    expect(comingSoonTitle.value).toBe('Test Title');
    expect(comingSoonMessage.value).toBe('Test Message');
  });

  it('uses default title and message when not provided', () => {
    const { openComingSoon, comingSoonTitle, comingSoonMessage } = useComingSoonInterstitial();

    openComingSoon();

    expect(comingSoonTitle.value).toBe('Coming Soon');
    expect(comingSoonMessage.value).toContain('finishing touches');
  });

  it('closes modal', () => {
    const { openComingSoon, closeComingSoon, isComingSoonVisible } = useComingSoonInterstitial();

    openComingSoon();
    expect(isComingSoonVisible.value).toBe(true);

    closeComingSoon();
    expect(isComingSoonVisible.value).toBe(false);
  });

  it('shares state across calls (singleton)', () => {
    const first = useComingSoonInterstitial();
    const second = useComingSoonInterstitial();

    first.openComingSoon({ title: 'Shared' });
    expect(second.comingSoonTitle.value).toBe('Shared');
    expect(second.isComingSoonVisible.value).toBe(true);

    second.closeComingSoon();
    expect(first.isComingSoonVisible.value).toBe(false);
  });
});
