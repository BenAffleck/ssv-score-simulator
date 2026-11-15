/** Shared visual constants — one palette for the table, charts and legend. */

/** Categorical series colours, ordered for maximum separation at small sizes. */
export const SERIES_COLORS = [
  '#2db1ff',
  '#f5c451',
  '#3fcf8e',
  '#f07a9c',
  '#6c588d',
  '#fb8a6b',
  '#4dd4d4',
  '#9aa8bd',
] as const;

export const PILLAR_COLORS = {
  community: '#6c588d',
  holdings: '#f5c451',
  votes: '#2db1ff',
} as const;

export const PILLAR_LABELS = {
  community: 'Community',
  holdings: 'Holdings',
  votes: 'Votes',
} as const;

/** One colour per delegation cohort, reused by the grid badges and breakdown. */
export const COHORT_COLORS = {
  ssvCommunity: '#2db1ff',
  verifiedOperators: '#3fcf8e',
  professional: '#6c588d',
  grantRecipients: '#f5c451',
  ethCommunities: '#f07a9c',
} as const;

export function colorFor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

/** Score → a 0–100 readout, or an em dash when the pillar has no data. */
export function fmtScore(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);
}

export function fmtTokens(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}

/** A signed change, blank when there is none. `tokens` formats like `fmtTokens`. */
export function fmtDelta(v: number | null | undefined, digits = 1, tokens = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  if (Math.abs(v) < (tokens ? 0.5 : 0.5 * 10 ** -digits)) return '±0';
  const sign = v > 0 ? '+' : '−';
  return `${sign}${tokens ? fmtTokens(Math.abs(v)) : Math.abs(v).toFixed(digits)}`;
}
