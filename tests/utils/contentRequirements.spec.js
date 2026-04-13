import { describe, it, expect } from 'vitest';
import { validateRequiredContentPaths } from '../../src/utils/contentRequirements.js';

describe('validateRequiredContentPaths', () => {
  it('returns valid when no required paths', () => {
    expect(validateRequiredContentPaths({}, [])).toEqual({ isValid: true, missing: [] });
    expect(validateRequiredContentPaths({}, undefined)).toEqual({ isValid: true, missing: [] });
  });

  it('validates a simple top-level key', () => {
    expect(validateRequiredContentPaths({ title: 'Hello' }, ['title'])).toEqual({
      isValid: true,
      missing: [],
    });
  });

  it('reports missing top-level key', () => {
    expect(validateRequiredContentPaths({}, ['title'])).toEqual({
      isValid: false,
      missing: ['title'],
    });
  });

  it('validates dot-path nested keys', () => {
    const content = { hero: { image: { src: 'test.jpg' } } };
    expect(validateRequiredContentPaths(content, ['hero.image.src'])).toEqual({
      isValid: true,
      missing: [],
    });
  });

  it('reports missing nested keys', () => {
    const content = { hero: {} };
    expect(validateRequiredContentPaths(content, ['hero.image.src'])).toEqual({
      isValid: false,
      missing: ['hero.image.src'],
    });
  });

  it('validates array bracket notation (items[])', () => {
    const content = { items: [{ id: 1 }, { id: 2 }] };
    expect(validateRequiredContentPaths(content, ['items[]'])).toEqual({
      isValid: true,
      missing: [],
    });
  });

  it('fails array bracket when array is empty', () => {
    expect(validateRequiredContentPaths({ items: [] }, ['items[]'])).toEqual({
      isValid: false,
      missing: ['items[]'],
    });
  });

  it('validates nested paths through arrays', () => {
    const content = { items: [{ name: 'a' }, { name: 'b' }] };
    expect(validateRequiredContentPaths(content, ['items[].name'])).toEqual({
      isValid: true,
      missing: [],
    });
  });

  it('rejects empty string values as unusable', () => {
    expect(validateRequiredContentPaths({ title: '' }, ['title'])).toEqual({
      isValid: false,
      missing: ['title'],
    });
  });

  it('rejects whitespace-only strings as unusable', () => {
    expect(validateRequiredContentPaths({ title: '   ' }, ['title'])).toEqual({
      isValid: false,
      missing: ['title'],
    });
  });

  it('rejects empty objects as unusable', () => {
    expect(validateRequiredContentPaths({ meta: {} }, ['meta'])).toEqual({
      isValid: false,
      missing: ['meta'],
    });
  });

  it('accepts 0 and false as usable values', () => {
    expect(validateRequiredContentPaths({ count: 0, active: false }, ['count', 'active'])).toEqual({
      isValid: true,
      missing: [],
    });
  });

  it('skips invalid path entries (non-string, empty)', () => {
    const result = validateRequiredContentPaths({ a: 1 }, [null, '', '  ', 'a']);
    expect(result).toEqual({ isValid: true, missing: [] });
  });

  it('reports multiple missing paths', () => {
    const result = validateRequiredContentPaths({}, ['title', 'body', 'image']);
    expect(result.isValid).toBe(false);
    expect(result.missing).toEqual(['title', 'body', 'image']);
  });
});
