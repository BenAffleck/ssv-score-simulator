/** The arithmetic that makes scores match production's Python in the last bit. */
import { describe, expect, it } from 'vitest';
import { decimalSumToNumber } from '../decimal.js';
import { pow } from '../pow.js';
import { pySum } from '../pysum.js';

describe('pySum', () => {
  it('compensates like CPython 3.12: sum([0.1] * 10) == 1.0', () => {
    expect(pySum(Array(10).fill(0.1))).toBe(1);
    expect(Array(10).fill(0.1).reduce((a, b) => a + b)).not.toBe(1);
  });

  it('sums nothing to 0', () => {
    expect(pySum([])).toBe(0);
  });
});

describe('pow', () => {
  it('is correctly rounded where V8 is not', () => {
    // 0.5 ** (3665700 / 86400 / 90): a vote decay production computed.
    expect(pow(0.5, 3665700 / 86400 / 90)).toBe(0.7212583209690268);
  });

  it('agrees with sqrt at p = 0.5', () => {
    for (const x of [0.0974707506302256, 0.25, 2, 1e-7, 123.456]) expect(pow(x, 0.5)).toBe(Math.sqrt(x));
  });

  it('handles the edges', () => {
    expect([pow(0, 0.5), pow(1, 0.3), pow(5, 0), pow(7, 1)]).toEqual([0, 1, 1, 7]);
  });
});

describe('decimalSumToNumber', () => {
  it('sums exactly, then rounds once', () => {
    expect(decimalSumToNumber('1500.500000000000000000', '999.500000000000000000')).toBe(2500);
    expect(decimalSumToNumber('0.100000000000000000', '0.200000000000000000')).toBe(0.3);
  });
});
