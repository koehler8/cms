import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useIntroGate } from '../../src/composables/useIntroGate.js';

describe('useIntroGate', () => {
  function setup(shared = {}, page = {}) {
    const siteData = ref({ shared: { content: { introGate: shared } } });
    const pageContent = ref({ introGate: page });
    return useIntroGate({ siteData, pageContent });
  }

  it('returns disabled when no config', () => {
    const { introGateEnabled } = setup();
    expect(introGateEnabled.value).toBe(false);
  });

  it('returns enabled when enabled is true', () => {
    const { introGateEnabled } = setup({ enabled: true });
    expect(introGateEnabled.value).toBe(true);
  });

  it('page config overrides shared config', () => {
    const { introGateProps } = setup(
      { title: 'Shared Title', body: 'Shared Body' },
      { title: 'Page Title' },
    );
    expect(introGateProps.value.title).toBe('Page Title');
    expect(introGateProps.value.body).toBe('Shared Body');
  });

  it('filters props to allowed keys only', () => {
    const { introGateProps } = setup({
      title: 'Title',
      body: 'Body',
      unknownKey: 'should be filtered',
      enabled: true,
    });
    expect(introGateProps.value.title).toBe('Title');
    expect(introGateProps.value.body).toBe('Body');
    expect(introGateProps.value.unknownKey).toBeUndefined();
    expect(introGateProps.value.enabled).toBeUndefined();
  });

  it('includes all allowed keys when present', () => {
    const config = {
      eyebrow: 'Eyebrow',
      title: 'Title',
      body: 'Body',
      primaryLabel: 'Go',
      secondaryLabel: 'Skip',
      secondaryHref: '/skip',
      storageKey: 'intro-seen',
      closeAriaLabel: 'Close',
    };
    const { introGateProps } = setup(config);
    for (const [key, value] of Object.entries(config)) {
      expect(introGateProps.value[key]).toBe(value);
    }
  });

  it('handles null/undefined siteData gracefully', () => {
    const siteData = ref(null);
    const pageContent = ref(null);
    const { introGateEnabled, introGateProps } = useIntroGate({ siteData, pageContent });
    expect(introGateEnabled.value).toBe(false);
    expect(introGateProps.value).toEqual({});
  });
});
