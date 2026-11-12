import { describe, expect, it } from 'vitest';
import {
  divRound,
  formatQty,
  formatRate,
  formatRupiah,
  lineAmount,
  parseDecimalToScaled,
  parseQty,
  parseRupiah,
  taxFromPercent,
  SCALES,
} from '../src/lib/money.js';

describe('parseRupiah', () => {
  it('parses plain integers', () => {
    expect(parseRupiah('21650000')).toBe(21650000n);
    expect(parseRupiah('0')).toBe(0n);
  });

  it('parses dotted thousand separators used by the source workbook', () => {
    expect(parseRupiah('43.300.000')).toBe(43300000n);
    expect(parseRupiah('1.234.567')).toBe(1234567n);
  });

  it('parses "Rp 4.330.000" and strips currency noise', () => {
    expect(parseRupiah('Rp 4.330.000')).toBe(4330000n);
    expect(parseRupiah('IDR 1.000')).toBe(1000n);
  });

  it('keeps negative values for signed adjustments', () => {
    expect(parseRupiah('-200000')).toBe(-200000n);
    expect(parseRupiah('-350.000')).toBe(-350000n);
  });

  it('rejects garbage instead of coercing to 0', () => {
    expect(parseRupiah('abc')).toBeNull();
    expect(parseRupiah('12abc')).toBeNull();
    expect(parseRupiah('')).toBeNull();
    expect(parseRupiah('1.2.3.4,')).toBeNull();
  });
});

describe('parseQty / decimals', () => {
  it('parses integer quantity', () => {
    expect(parseQty('1')).toBe(1000n);
    expect(parseQty('12')).toBe(12000n);
  });

  it('parses comma and dot decimals', () => {
    expect(parseQty('2,5')).toBe(2500n);
    expect(parseQty('2.5')).toBe(2500n);
    expect(parseQty('0,125')).toBe(125n);
  });

  it('parses mixed grouping + decimal', () => {
    expect(parseQty('1.234,5')).toBe(1234500n);
    expect(parseQty('1,234.5')).toBe(1234500n);
  });

  it('rejects more precision than supported', () => {
    expect(parseQty('1,23456')).toBeNull();
  });

  it('rejects empty / negative-sign-only', () => {
    expect(parseQty('')).toBeNull();
    expect(parseQty('-')).toBeNull();
  });
});

describe('line amount rounding', () => {
  it('multiplies qty by unit price exactly', () => {
    expect(lineAmount(1000n, 21650000n)).toBe(21650000n);
    expect(lineAmount(2500n, 4000n)).toBe(10000n);
  });

  it('rounds half away from zero, never floats', () => {
    // 0.5 * 3 = 1.5 -> 2
    expect(lineAmount(500n, 3n)).toBe(2n);
    // 0.5 * 5 = 2.5 -> 3
    expect(lineAmount(500n, 5n)).toBe(3n);
    // negative mirror: -0.5 * 5 = -2.5 -> -3
    expect(lineAmount(-500n, 5n)).toBe(-3n);
  });

  it('0.1 * 3 does not produce a floating point artifact', () => {
    expect(lineAmount(100n, 3n)).toBe(0n);
    expect(lineAmount(100n, 30n)).toBe(3n);
  });

  it('divRound guards division by zero', () => {
    expect(() => divRound(1n, 0n)).toThrow();
  });
});

describe('tax', () => {
  it('computes percent tax with explicit user rate', () => {
    expect(taxFromPercent(1000000n, 11000000n)).toBe(110000n); // 11%
    expect(taxFromPercent(4330000n, 2500000n)).toBe(108250n); // 2.5%
  });

  it('zero rate yields zero tax, not a default rate', () => {
    expect(taxFromPercent(1000000n, 0n)).toBe(0n);
  });

  it('rounds half away from zero', () => {
    expect(taxFromPercent(1n, 500000n)).toBe(0n); // 0.5 -> 1? no: 1*0.5% = 0.005
    expect(taxFromPercent(100n, 500000n)).toBe(1n); // 0.5 -> 1
  });

  it('parses rate decimals', () => {
    expect(parseDecimalToScaled('2,5', SCALES.rate)).toBe(2500000n);
    expect(parseDecimalToScaled('11', SCALES.rate)).toBe(11000000n);
  });
});

describe('formatting', () => {
  it('formats rupiah with dot grouping', () => {
    expect(formatRupiah(43300000n)).toBe('43.300.000');
    expect(formatRupiah(0n)).toBe('0');
  });

  it('formats negative amounts in accounting parentheses like the source', () => {
    expect(formatRupiah(-200000n)).toBe('(200.000)');
  });

  it('formats qty and rate without trailing zeros', () => {
    expect(formatQty(1000n)).toBe('1');
    expect(formatQty(2500n)).toBe('2,5');
    expect(formatRate(11000000n)).toBe('11');
    expect(formatRate(2500000n)).toBe('2,5');
  });
});
