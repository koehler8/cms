import { describe, it, expect } from 'vitest';
import { buildJsonLdScripts } from '../../src/utils/jsonLd.js';

function setup(overrides = {}) {
  return buildJsonLdScripts({
    siteData: { site: { jsonld: overrides.siteJsonld } },
    currentPage: { jsonld: overrides.pageJsonld },
    isDraft: overrides.isDraft || false,
    isNotFound: overrides.isNotFound || false,
  });
}

describe('buildJsonLdScripts', () => {
  it('returns [] when nothing is configured', () => {
    expect(setup()).toEqual([]);
  });

  it('returns [] for drafts even when jsonld is set', () => {
    expect(
      setup({
        pageJsonld: { '@type': 'Article', name: 'Top Secret' },
        isDraft: true,
      }),
    ).toEqual([]);
  });

  it('returns [] for 404 pages even when jsonld is set', () => {
    expect(
      setup({
        pageJsonld: { '@type': 'Article' },
        isNotFound: true,
      }),
    ).toEqual([]);
  });

  it('emits a single script for a single page block', () => {
    const scripts = setup({
      pageJsonld: { '@type': 'Article', headline: 'Hi' },
    });
    expect(scripts).toHaveLength(1);
    expect(scripts[0].type).toBe('application/ld+json');
    expect(JSON.parse(scripts[0].innerHTML)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Hi',
    });
  });

  it('emits multiple scripts for an array', () => {
    const scripts = setup({
      pageJsonld: [
        { '@type': 'Article', headline: 'A' },
        { '@type': 'BreadcrumbList' },
      ],
    });
    expect(scripts).toHaveLength(2);
    expect(JSON.parse(scripts[0].innerHTML)['@type']).toBe('Article');
    expect(JSON.parse(scripts[1].innerHTML)['@type']).toBe('BreadcrumbList');
  });

  it('preserves an explicit @context when provided', () => {
    const scripts = setup({
      pageJsonld: { '@context': 'https://schema.org/v3', '@type': 'Person' },
    });
    expect(JSON.parse(scripts[0].innerHTML)['@context']).toBe('https://schema.org/v3');
  });

  it('injects default @context when missing', () => {
    const scripts = setup({
      pageJsonld: { '@type': 'Person', name: 'Jamie' },
    });
    expect(JSON.parse(scripts[0].innerHTML)['@context']).toBe('https://schema.org');
  });

  it('appends page blocks AFTER site blocks', () => {
    const scripts = setup({
      siteJsonld: { '@type': 'Organization', name: 'Site Co' },
      pageJsonld: { '@type': 'Article', headline: 'Hi' },
    });
    expect(scripts).toHaveLength(2);
    expect(JSON.parse(scripts[0].innerHTML)['@type']).toBe('Organization');
    expect(JSON.parse(scripts[1].innerHTML)['@type']).toBe('Article');
  });

  it('skips invalid (non-object) entries', () => {
    const scripts = setup({
      pageJsonld: [
        { '@type': 'Article' },
        null,
        'not-an-object',
        42,
        { '@type': 'Person' },
      ],
    });
    expect(scripts).toHaveLength(2);
  });

  it('emits unique keys per block', () => {
    const scripts = setup({
      pageJsonld: [
        { '@type': 'Article' },
        { '@type': 'Article' },
      ],
    });
    expect(scripts[0].key).not.toBe(scripts[1].key);
  });

  it('handles missing siteData gracefully', () => {
    expect(buildJsonLdScripts({ currentPage: { jsonld: { '@type': 'Article' } } })).toHaveLength(1);
  });

  it('handles missing currentPage gracefully', () => {
    expect(
      buildJsonLdScripts({ siteData: { site: { jsonld: { '@type': 'Organization' } } } }),
    ).toHaveLength(1);
  });
});
