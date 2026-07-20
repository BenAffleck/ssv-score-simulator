/**
 * TWAB must average over days that were actually collected.
 *
 * Regression: uncollected days were counted as a zero balance, so a 5-day
 * backfill with T=180 turned a steady 12,000-token holder into a TWAB of 333
 * (holdings 18 instead of 100) — silently wrong, and worst exactly when
 * someone is calibrating on a short trial backfill.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates.js';
import { buildBalanceSeries, holdingsScore, twab, twabFromSeries } from '../holdings.js';
import { DEFAULT_PARAMS } from '../params.js';
import { indexDataset, simulate } from '../simulate.js';
import type { Dataset } from '../types.js';

const END = '2026-07-20';
const H = DEFAULT_PARAMS.holdings;

const steady = (days: number, total: number) =>
  Array.from({ length: days }, (_, i) => ({ date: addDays(END, -i), total }));

describe('window is intersected with collected coverage', () => {
  it('a 5-day backfill reports the true balance at any T', () => {
    const samples = steady(5, 12_000);
    for (const T of [5, 30, 90, 180, 365]) {
      expect(twab(samples, END, T)).toBeCloseTo(12_000, 6);
      expect(holdingsScore(twab(samples, END, T)!, { ...H, windowDays: T })).toBe(100);
    }
  });

  it('uses the full window once history is long enough', () => {
    // 200 days collected: 100 days at 0, then 100 days at 20,000.
    const samples = Array.from({ length: 200 }, (_, i) => ({
      date: addDays(END, -i),
      total: i < 100 ? 20_000 : 0,
    }));
    // T=180 spans 80 zero days + 100 funded days.
    expect(twab(samples, END, 180)).toBeCloseTo((100 * 20_000) / 180, 6);
    // T=100 covers only the funded stretch.
    expect(twab(samples, END, 100)).toBeCloseTo(20_000, 6);
  });

  it('recorded zeros still dilute — flash-loan protection is intact', () => {
    // 180 days collected; tokens acquired only in the last 2.
    const flashed = (amount: number) =>
      twab(
        Array.from({ length: 180 }, (_, i) => ({ date: addDays(END, -i), total: i <= 1 ? amount : 0 })),
        END,
        180,
      )!;

    // Two days of a million averages down to ~1.1% of its nominal size.
    expect(flashed(1_000_000)).toBeCloseTo((2 * 1_000_000) / 180, 0);
    expect(flashed(1_000_000) / 1_000_000).toBeLessThan(0.02);

    // Compared below the reference cap, a late 100k buyer scores far under a
    // steady 10k holder despite holding 10× more on the day.
    expect(holdingsScore(flashed(100_000), H)).toBeLessThan(holdingsScore(10_000, H) / 2);
  });

  it('coverage is dataset-level, so a short history is no advantage', () => {
    // Long-standing holder: 180 days, funded only recently.
    const longHistory = Array.from({ length: 180 }, (_, i) => ({
      date: addDays(END, -i),
      total: i <= 4 ? 50_000 : 0,
    }));
    // Newcomer with only 5 collected days at the same balance.
    const shortHistory = steady(5, 50_000);
    const coverageStart = addDays(END, -179);

    // Evaluated against the same dataset-wide coverage, the newcomer is
    // diluted identically rather than scoring on their 5 good days alone.
    expect(twab(shortHistory, END, 180, coverageStart)).toBeCloseTo(
      twab(longHistory, END, 180)!,
      6,
    );
  });

  it('returns null before any data exists — unmeasured, not zero', () => {
    expect(twab(steady(5, 100), '2020-01-01', 180)).toBeNull();
    expect(twab([], END, 180)).toBeNull();
  });

  it('never looks ahead of the as-of date', () => {
    const samples = [
      { date: addDays(END, -30), total: 1_000 },
      { date: addDays(END, 5), total: 999_999 },
    ];
    // The future balance must not leak in; every covered day holds 1,000.
    expect(twab(samples, END, 180)).toBeCloseTo(1_000, 6);
  });
});

describe('reference and fast paths agree', () => {
  it('twab() matches twabFromSeries() across windows and dates', () => {
    const samples = Array.from({ length: 120 }, (_, i) => ({
      date: addDays(END, -i),
      total: (i * 7919) % 5_000, // deterministic, irregular
    }));
    const start = addDays(END, -119);
    const series = buildBalanceSeries(samples, start, END);

    for (const T of [1, 7, 30, 90, 180]) {
      for (const back of [0, 1, 13, 60, 119]) {
        const asOf = addDays(END, -back);
        expect(twabFromSeries(series, asOf, T)).toBeCloseTo(twab(samples, asOf, T, start)!, 9);
      }
    }
  });
});

describe('twabDays is reported for auditability', () => {
  function dataset(days: number): Dataset {
    const addr = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    return {
      generatedAt: new Date(0).toISOString(),
      space: 's',
      dateRange: { start: addDays(END, -(days - 1)), end: END },
      delegates: [{ address: addr, forumHandle: '', discordUsername: '', displayName: 'A' }],
      balances: Array.from({ length: days }, (_, i) => ({
        address: addr,
        date: addDays(END, -i),
        ssvErc20: 6_000,
        cssv: 6_000,
      })),
      proposals: [],
      votes: [],
      highsignal: [],
    };
  }

  it('reports the truncated window when history is shorter than T', () => {
    const row = simulate(indexDataset(dataset(5)), DEFAULT_PARAMS, END)[0]!;
    expect(row.raw.twabDays).toBe(5); // not 180
    expect(row.raw.twab).toBeCloseTo(12_000, 6);
    expect(row.pillars.holdings).toBe(100);
  });

  it('reports the full window when history is long enough', () => {
    const row = simulate(indexDataset(dataset(200)), DEFAULT_PARAMS, END)[0]!;
    expect(row.raw.twabDays).toBe(180);
  });
});
