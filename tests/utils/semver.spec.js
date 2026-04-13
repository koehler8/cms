import { describe, it, expect } from 'vitest';
import { compareVersions, satisfiesMinVersion } from '../../src/utils/semver.js';

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns 1 when a > b (major)', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
  });

  it('returns -1 when a < b (major)', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });

  it('compares minor versions', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
  });

  it('compares patch versions', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBe(1);
    expect(compareVersions('1.0.1', '1.0.2')).toBe(-1);
  });

  it('treats prerelease as less than release', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1);
  });

  it('compares prerelease strings lexicographically', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0);
  });

  it('pads missing segments with 0', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('handles invalid/empty input as 0.0.0', () => {
    expect(compareVersions(undefined, undefined)).toBe(0);
    expect(compareVersions('', '')).toBe(0);
    expect(compareVersions(null, '1.0.0')).toBe(-1);
  });

  it('trims whitespace', () => {
    expect(compareVersions(' 1.0.0 ', '1.0.0')).toBe(0);
  });
});

describe('satisfiesMinVersion', () => {
  it('returns true when no required version', () => {
    expect(satisfiesMinVersion('1.0.0', '')).toBe(true);
    expect(satisfiesMinVersion('1.0.0', null)).toBe(true);
    expect(satisfiesMinVersion('1.0.0', undefined)).toBe(true);
  });

  it('returns true when current >= required', () => {
    expect(satisfiesMinVersion('2.0.0', '1.0.0')).toBe(true);
    expect(satisfiesMinVersion('1.0.0', '1.0.0')).toBe(true);
  });

  it('returns false when current < required', () => {
    expect(satisfiesMinVersion('0.9.0', '1.0.0')).toBe(false);
  });

  it('handles prerelease versions', () => {
    expect(satisfiesMinVersion('1.0.0-beta', '1.0.0')).toBe(false);
    expect(satisfiesMinVersion('1.0.0', '1.0.0-beta')).toBe(true);
  });
});
