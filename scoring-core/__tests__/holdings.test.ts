import { describe, expect, it } from 'vitest';
import { holdingsScore, twab } from '../holdings.js';
import { DEFAULT_PARAMS } from '../params.js';
import { AS_OF } from './fixtures.js';

const H = DEFAULT_PARAMS.holdings;

describe('Table 2 — the flattening curve (HOLD_REF = 10,000)', () => {
  const cases: Array<[number, number]> = [
    [100, 10],
    [1_000, 31.6],
    [2_500, 50],
    [10_000, 100],
    [100_000, 100],
    [1_000_000, 100],
  ];

  for (const [holding, expected] of cases) {
    it(`${holding.toLocaleString()} → ${expected}`, () => {
      expect(holdingsScore(holding, H)).toBeCloseTo(expected, 1);
    });
  }

  it('100× the tokens yields only 10× the score', () => {
    expect(holdingsScore(100, H) * 10).toBeCloseTo(holdingsScore(10_000, H), 6);
  });
});

describe('concavity lever (acceptance §5)', () => {
  it('p = 1.0 is linear — no dampening below the cap', () => {
    const linear = { ...H, concavity: 1.0 };
    expect(holdingsScore(2_500, linear)).toBeCloseTo(25, 6);
    expect(holdingsScore(5_000, linear)).toBeCloseTo(50, 6);
    expect(holdingsScore(10_000, linear)).toBe(100);
  });

  it('the reference cap still binds at p = 1.0', () => {
    expect(holdingsScore(1_000_000, { ...H, concavity: 1.0 })).toBe(100);
  });

  it('lower p flattens harder: 0.3 > 0.5 > 1.0 for a sub-reference holding', () => {
    const at = (p: number) => holdingsScore(1_000, { ...H, concavity: p });
    expect(at(0.3)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(1.0));
  });

  it('log mode over-flattens relative to sqrt, as the proposal argues', () => {
    const log = holdingsScore(1_000, { ...H, mode: 'log' });
    const sqrt = holdingsScore(1_000, H);
    expect(log).toBeGreaterThan(sqrt);
    expect(holdingsScore(10_000, { ...H, mode: 'log' })).toBeCloseTo(100, 6);
  });
});

describe('edge cases', () => {
  it('zero and negative balances score 0', () => {
    expect(holdingsScore(0, H)).toBe(0);
    expect(holdingsScore(-5, H)).toBe(0);
  });
});

describe('TWAB — time weighting', () => {
  const day = (offset: number) =>
    new Date(Date.parse(`${AS_OF}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

  it('averages a flat balance to itself', () => {
    const samples = Array.from({ length: 200 }, (_, i) => ({ date: day(-i), total: 2_500 }));
    expect(twab(samples, AS_OF, 180)).toBeCloseTo(2_500, 6);
  });

  it('gives tokens bought yesterday near-zero weight over a 180-day window', () => {
    const flashed = (amount: number) =>
      twab(
        Array.from({ length: 200 }, (_, i) => ({ date: day(-i), total: i <= 1 ? amount : 0 })),
        AS_OF,
        180,
      )!;

    // Two days of a million averages down to ~1.1% of its nominal size.
    expect(flashed(1_000_000)).toBeCloseTo((2 * 1_000_000) / 180, 0);
    expect(flashed(1_000_000) / 1_000_000).toBeLessThan(0.02);

    // So a last-minute 100k buyer is scored far below a steady 10k holder,
    // despite holding 10× more at the moment of the vote.
    expect(holdingsScore(flashed(100_000), H)).toBeLessThan(holdingsScore(10_000, H) / 2);
  });

  it('a sustained holder beats an identical balance acquired late', () => {
    const sustained = twab(
      Array.from({ length: 200 }, (_, i) => ({ date: day(-i), total: 10_000 })),
      AS_OF,
      180,
    )!;
    const late = twab(
      Array.from({ length: 200 }, (_, i) => ({ date: day(-i), total: i <= 20 ? 10_000 : 0 })),
      AS_OF,
      180,
    )!;
    expect(holdingsScore(sustained, H)).toBe(100);
    expect(holdingsScore(late, H)).toBeLessThan(40);
  });

  it('carries a balance forward across days with no sample', () => {
    const samples = [
      { date: day(-179), total: 1_000 },
      { date: day(-10), total: 1_000 },
    ];
    expect(twab(samples, AS_OF, 180)).toBeCloseTo(1_000, 6);
  });

  it('ignores samples after the as-of date (no look-ahead)', () => {
    const samples = [
      { date: day(-30), total: 1_000 },
      { date: day(+5), total: 999_999 },
    ];
    // Every collected day at or before as-of holds 1,000; the later balance
    // must not leak in. (Uncollected days are not averaged in as zeros — see
    // twab-coverage.test.ts.)
    expect(twab(samples, AS_OF, 180)).toBeCloseTo(1_000, 6);
  });

  it('returns null when the delegate has no data at all', () => {
    expect(twab([], AS_OF, 180)).toBeNull();
    expect(twab([{ date: day(+1), total: 5 }], AS_OF, 180)).toBeNull();
  });

  it('a shorter window reacts faster to a recent purchase', () => {
    const samples = Array.from({ length: 200 }, (_, i) => ({
      date: day(-i),
      total: i <= 30 ? 10_000 : 0,
    }));
    expect(twab(samples, AS_OF, 30)!).toBeGreaterThan(twab(samples, AS_OF, 180)!);
  });
});
