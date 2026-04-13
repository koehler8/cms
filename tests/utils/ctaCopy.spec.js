import { describe, it, expect } from 'vitest';
import { resolveCtaCopy } from '../../src/utils/ctaCopy.js';

describe('resolveCtaCopy', () => {
  const makeSiteData = (ctaCopy) => ({ site: { ctaCopy } });

  it('resolves label from active variant', () => {
    const siteData = makeSiteData({
      activeVariant: 'launch',
      variants: {
        launch: { 'buy-now': 'Buy Now!' },
      },
    });
    expect(resolveCtaCopy(siteData, 'buy-now', 'Default')).toBe('Buy Now!');
  });

  it('falls back to fallbackVariant when active missing', () => {
    const siteData = makeSiteData({
      activeVariant: 'missing',
      fallbackVariant: 'launch',
      variants: {
        launch: { 'sign-up': 'Sign Up' },
      },
    });
    expect(resolveCtaCopy(siteData, 'sign-up', 'Default')).toBe('Sign Up');
  });

  it('falls back to default variant', () => {
    const siteData = makeSiteData({
      activeVariant: 'missing',
      variants: {
        default: { cta: 'Click Me' },
      },
    });
    expect(resolveCtaCopy(siteData, 'cta', 'Fallback')).toBe('Click Me');
  });

  it('returns fallback when no config', () => {
    expect(resolveCtaCopy({}, 'cta', 'Fallback')).toBe('Fallback');
    expect(resolveCtaCopy(null, 'cta', 'Fallback')).toBe('Fallback');
  });

  it('normalizes camelCase keys to kebab-case', () => {
    const siteData = makeSiteData({
      activeVariant: 'v1',
      variants: { v1: { 'buy-now': 'Buy' } },
    });
    expect(resolveCtaCopy(siteData, 'buyNow', 'Default')).toBe('Buy');
  });

  it('normalizes kebab-case keys to camelCase lookup', () => {
    const siteData = makeSiteData({
      activeVariant: 'v1',
      variants: { v1: { buyNow: 'Buy' } },
    });
    expect(resolveCtaCopy(siteData, 'buy-now', 'Default')).toBe('Buy');
  });

  it('trims whitespace from labels', () => {
    const siteData = makeSiteData({
      activeVariant: 'v1',
      variants: { v1: { cta: '  Trimmed  ' } },
    });
    expect(resolveCtaCopy(siteData, 'cta', 'Default')).toBe('Trimmed');
  });

  it('unwraps Vue refs (objects with .value)', () => {
    const ref = { value: makeSiteData({
      activeVariant: 'v1',
      variants: { v1: { cta: 'From Ref' } },
    }) };
    expect(resolveCtaCopy(ref, 'cta', 'Default')).toBe('From Ref');
  });

  it('returns fallback when variant has no matching key', () => {
    const siteData = makeSiteData({
      activeVariant: 'v1',
      variants: { v1: { other: 'Other' } },
    });
    expect(resolveCtaCopy(siteData, 'cta', 'Fallback')).toBe('Fallback');
  });

  it('is case-insensitive for active variant name', () => {
    const siteData = makeSiteData({
      activeVariant: 'LaUnCh',
      variants: { launch: { cta: 'Go' } },
    });
    expect(resolveCtaCopy(siteData, 'cta', 'Default')).toBe('Go');
  });
});
