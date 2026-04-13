import { describe, it, expect } from 'vitest';
import { inflateFlatConfig } from '../../src/utils/inflateFlatConfig.js';

describe('inflateFlatConfig', () => {
  it('inflates dot-notation keys to nested objects', () => {
    expect(inflateFlatConfig({ 'a.b.c': 1 })).toEqual({ a: { b: { c: 1 } } });
  });

  it('handles multiple paths sharing a prefix', () => {
    expect(inflateFlatConfig({
      'site.name': 'Test',
      'site.url': 'https://example.com',
    })).toEqual({
      site: { name: 'Test', url: 'https://example.com' },
    });
  });

  it('handles array bracket notation', () => {
    expect(inflateFlatConfig({ 'items[0].value': 'a' })).toEqual({
      items: [{ value: 'a' }],
    });
  });

  it('handles nested array indices', () => {
    expect(inflateFlatConfig({
      'items[0].name': 'first',
      'items[1].name': 'second',
    })).toEqual({
      items: [{ name: 'first' }, { name: 'second' }],
    });
  });

  it('skips keys starting with $', () => {
    expect(inflateFlatConfig({
      '$schema': 'ignored',
      'real.key': 'kept',
    })).toEqual({ real: { key: 'kept' } });
  });

  it('handles flat (non-dotted) keys', () => {
    expect(inflateFlatConfig({ simple: 'value' })).toEqual({ simple: 'value' });
  });

  it('returns input as-is for non-object input', () => {
    expect(inflateFlatConfig(null)).toBeNull();
    expect(inflateFlatConfig(undefined)).toBeUndefined();
    expect(inflateFlatConfig('string')).toBe('string');
  });

  it('returns empty object for empty input', () => {
    expect(inflateFlatConfig({})).toEqual({});
  });
});
