import { describe, it, expect } from 'vitest';
import { unwrapDefault } from '../../src/utils/unwrapDefault.js';

describe('unwrapDefault', () => {
  it('returns module.default when present', () => {
    const mod = { default: 'hello' };
    expect(unwrapDefault(mod)).toBe('hello');
  });

  it('returns module.default even when falsy', () => {
    expect(unwrapDefault({ default: 0 })).toBe(0);
    expect(unwrapDefault({ default: '' })).toBe('');
    expect(unwrapDefault({ default: null })).toBe(null);
  });

  it('returns the module itself when no default export', () => {
    const mod = { named: 'export' };
    expect(unwrapDefault(mod)).toBe(mod);
  });

  it('returns undefined for falsy input', () => {
    expect(unwrapDefault(null)).toBeUndefined();
    expect(unwrapDefault(undefined)).toBeUndefined();
    expect(unwrapDefault(0)).toBeUndefined();
    expect(unwrapDefault('')).toBeUndefined();
    expect(unwrapDefault(false)).toBeUndefined();
  });

  it('returns non-object values directly', () => {
    expect(unwrapDefault(42)).toBe(42);
    expect(unwrapDefault('string')).toBe('string');
  });
});
