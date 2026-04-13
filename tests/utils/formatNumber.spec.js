import { describe, it, expect } from 'vitest';
import {
  formatDecimal,
  formatCurrency,
  formatCompact,
  formatPercent,
  formatTokenAmount,
  formatUsd,
  formatWithFallback,
} from '../../src/utils/formatNumber.js';

describe('formatDecimal', () => {
  it('formats a basic number', () => {
    expect(formatDecimal(1234.56)).toBe('1,234.56');
  });

  it('respects minimumFractionDigits', () => {
    expect(formatDecimal(5, { minimumFractionDigits: 2 })).toBe('5.00');
  });

  it('respects maximumFractionDigits', () => {
    expect(formatDecimal(1.23456, { maximumFractionDigits: 3 })).toBe('1.235');
  });

  it('coerces null/undefined to 0', () => {
    expect(formatDecimal(null)).toBe('0');
    expect(formatDecimal(undefined)).toBe('0');
  });

  it('coerces NaN to 0', () => {
    expect(formatDecimal(NaN)).toBe('0');
  });

  it('coerces bigint to number', () => {
    expect(formatDecimal(BigInt(1000))).toBe('1,000');
  });

  it('supports compact notation', () => {
    const result = formatDecimal(1500, { compact: true });
    expect(result).toMatch(/1\.5K|1\.5k/i);
  });

  it('can disable grouping', () => {
    expect(formatDecimal(1234, { useGrouping: false })).toBe('1234');
  });
});

describe('formatCurrency', () => {
  it('formats USD by default', () => {
    const result = formatCurrency(99.99);
    expect(result).toContain('99.99');
    expect(result).toMatch(/\$/);
  });

  it('supports other currencies', () => {
    const result = formatCurrency(100, { currency: 'EUR' });
    expect(result).toContain('100.00');
  });
});

describe('formatCompact', () => {
  it('formats large numbers compactly', () => {
    const result = formatCompact(1_200_000);
    expect(result).toMatch(/1\.2M/i);
  });

  it('formats thousands', () => {
    const result = formatCompact(2500);
    expect(result).toMatch(/2\.5K/i);
  });
});

describe('formatPercent', () => {
  it('formats a percentage (divides by 100 by default)', () => {
    expect(formatPercent(50)).toBe('50%');
  });

  it('uses assumeFraction to skip division', () => {
    expect(formatPercent(0.5, { assumeFraction: true })).toBe('50%');
  });

  it('handles fractional percents', () => {
    expect(formatPercent(12.5)).toBe('12.5%');
  });
});

describe('formatTokenAmount', () => {
  it('delegates to formatDecimal', () => {
    expect(formatTokenAmount(1234)).toBe(formatDecimal(1234));
  });
});

describe('formatUsd', () => {
  it('formats as USD currency', () => {
    expect(formatUsd(42)).toMatch(/\$42\.00/);
  });
});

describe('formatWithFallback', () => {
  it('returns fallback for null', () => {
    expect(formatWithFallback(null, 'N/A')).toBe('N/A');
  });

  it('returns fallback for undefined', () => {
    expect(formatWithFallback(undefined, '--')).toBe('--');
  });

  it('returns formatted value for valid number', () => {
    expect(formatWithFallback(100, '0')).toBe('100');
  });

  it('uses default fallback of "0"', () => {
    expect(formatWithFallback(null)).toBe('0');
  });

  it('uses custom formatter', () => {
    const formatter = (v) => `$${v}`;
    expect(formatWithFallback(10, '--', formatter)).toBe('$10');
  });
});
