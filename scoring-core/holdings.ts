/**
 * Pillar 2 — Token Holdings.
 * Time-weighted (TWAB) → concave-dampened → reference-capped onto 0–100.
 */
import { addDays, daysBetween } from './dates.js';
import type { ScoringParams } from './types.js';

export interface BalanceSample {
  /** YYYY-MM-DD */
  date: string;
  /** Holdings base for that day: ssvErc20 + cssv (1:1). */
  total: number;
}

/**
 * A delegate's daily holdings base over the collection window, densified with
 * carry-forward and stored as a prefix sum so any TWAB window is an O(1)
 * lookup instead of a day-by-day walk.
 */
export interface BalanceSeries {
  /** First covered date (YYYY-MM-DD). */
  start: string;
  /** Number of covered days. */
  days: number;
  /** prefix[i] = Σ dailyTotal[0 .. i-1]; length days + 1. */
  prefix: Float64Array;
}

/**
 * Densify samples across `[start, end]`.
 *
 * A day with no sample carries forward the last known balance — a balance
 * persists until it changes. Days before the first sample are 0, which is what
 * makes freshly-acquired stake dilute: the collector records an explicit 0 row
 * for every delegate on every collected day, so "held nothing then" is a
 * recorded fact, not an assumption.
 *
 * `start`/`end` must be the *dataset's* collection range, shared by every
 * delegate — see `twabFromSeries`.
 */
export function buildBalanceSeries(
  samples: BalanceSample[],
  start: string,
  end: string,
): BalanceSeries | null {
  if (samples.length === 0) return null;

  const days = Math.round(daysBetween(start, end)) + 1;
  if (days <= 0) return null;

  const sorted = [...samples].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const prefix = new Float64Array(days + 1);

  let idx = 0;
  let carried = 0;
  // Opening balance: the last sample strictly before the window.
  while (idx < sorted.length && sorted[idx]!.date < start) {
    carried = sorted[idx]!.total;
    idx++;
  }

  let day = start;
  for (let i = 0; i < days; i++) {
    while (idx < sorted.length && sorted[idx]!.date <= day) {
      carried = sorted[idx]!.total;
      idx++;
    }
    prefix[i + 1] = prefix[i]! + carried;
    day = addDays(day, 1);
  }

  return { start, days, prefix };
}

/**
 * Stage A — Time-Weighted Average Balance ending at `asOf`.
 *
 * The window is `[asOf - T + 1, asOf]`, **intersected with the days actually
 * collected**. Averaging over uncollected days would divide by a period we
 * never measured: with a 5-day backfill and T=180, a steady 12,000-token
 * holder would read as a TWAB of 333 and score 18 instead of 100.
 *
 * Because coverage is dataset-level rather than per-delegate, a delegate with
 * a shorter history gains no advantage — everyone is averaged over the same
 * days, and recorded zeros still dilute exactly as before.
 *
 * Returns null when `asOf` precedes all collected data, or the delegate has
 * none — that is "unmeasured", distinct from a measured zero, and is resolved
 * by `missingPolicy` upstream.
 */
export function twabFromSeries(
  series: BalanceSeries | null,
  asOf: string,
  windowDays: number,
): number | null {
  if (!series) return null;
  return twabAtOffset(series, Math.round(daysBetween(series.start, asOf)), windowDays);
}

/**
 * As `twabFromSeries`, but taking the day offset from `series.start` directly.
 *
 * Every delegate shares the same coverage start, so the pipeline resolves the
 * offset once per as-of date rather than re-parsing dates per delegate.
 */
export function twabAtOffset(
  series: BalanceSeries | null,
  offset: number,
  windowDays: number,
): number | null {
  if (!series || offset < 0) return null; // asOf precedes any collected data

  const span = windowSpan(series, offset, windowDays);
  if (span === null) return null;

  return (series.prefix[span.end + 1]! - series.prefix[span.begin]!) / span.covered;
}

/** How many days the TWAB actually averaged over — for auditability. */
export function twabWindowDays(
  series: BalanceSeries | null,
  offset: number,
  windowDays: number,
): number {
  if (!series || offset < 0) return 0;
  return windowSpan(series, offset, windowDays)?.covered ?? 0;
}

function windowSpan(
  series: BalanceSeries,
  offset: number,
  windowDays: number,
): { begin: number; end: number; covered: number } | null {
  // Past the last collected day, evaluate at that day rather than inventing
  // history: the answer is "TWAB as of the most recent collection".
  const end = Math.min(offset, series.days - 1);
  if (end < 0) return null;
  const begin = Math.max(0, end - Math.max(1, Math.floor(windowDays)) + 1);
  const covered = end - begin + 1;
  return covered > 0 ? { begin, end, covered } : null;
}

/**
 * Convenience wrapper: densify then query. The scoring pipeline builds the
 * series once per delegate and calls `twabFromSeries` directly, so the
 * averaging math lives in exactly one place.
 *
 * Without an explicit `coverageStart`, coverage is inferred from the samples
 * themselves.
 */
export function twab(
  samples: BalanceSample[],
  asOf: string,
  windowDays: number,
  coverageStart?: string,
): number | null {
  if (samples.length === 0) return null;

  let first = samples[0]!.date;
  let last = samples[0]!.date;
  for (const s of samples) {
    if (s.date < first) first = s.date;
    if (s.date > last) last = s.date;
  }

  const start = coverageStart ?? first;
  const end = last > start ? last : start;
  return twabFromSeries(buildBalanceSeries(samples, start, end), asOf, windowDays);
}

/**
 * Stages B + C — concave dampening and the reference cap.
 *
 *   power: 100 · min(1, (TWAB / ref)^p)      p = 0.5 → the proposal's √ curve
 *   log:   100 · min(1, ln(1+TWAB) / ln(1+ref))
 */
export function holdingsScore(twabValue: number, opts: ScoringParams['holdings']): number {
  const value = Math.max(0, twabValue);
  const ref = Math.max(1e-9, opts.ref);
  if (opts.mode === 'log') {
    return clamp01(Math.log(1 + value) / Math.log(1 + ref)) * 100;
  }
  return clamp01((value / ref) ** opts.concavity) * 100;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
