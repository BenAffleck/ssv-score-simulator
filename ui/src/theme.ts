/** Shared visual constants — one palette for the table, charts and legend. */

/** Categorical series colours, ordered for maximum separation at small sizes. */
export const SERIES_COLORS = [
  '#5aa9f7',
  '#f5c451',
  '#3fcf8e',
  '#f07a9c',
  '#a78bfa',
  '#fb8a6b',
  '#4dd4d4',
  '#9aa8bd',
] as const;

export const PILLAR_COLORS = {
  community: '#a78bfa',
  holdings: '#f5c451',
  votes: '#5aa9f7',
} as const;

export const PILLAR_LABELS = {
  community: 'Community',
  holdings: 'Holdings',
  votes: 'Votes',
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
