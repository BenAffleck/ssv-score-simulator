/**
 * Pillar 3 — Snapshot Participation, recency-weighted.
 *
 *   d_p     = 0.5 ^ (age_p / H)
 *   S_votes = 100 · Σ(voted_p · d_p) / Σ(d_p)
 *
 * over the N most recent proposals closed at or before the as-of date.
 */
import { DAY_SECONDS, dateToTs } from './dates.js';
import type { ProposalRow, ScoringParams } from './types.js';

export function recencyWeight(ageDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return ageDays <= 0 ? 1 : 0;
  return 0.5 ** (Math.max(0, ageDays) / halfLifeDays);
}

export interface VotesResult {
  score: number | null;
  votedCount: number;
  proposalCount: number;
}

/** End of the as-of day — the instant every proposal age is measured from. */
export function asOfTimestamp(asOf: string): number {
  return dateToTs(asOf) + DAY_SECONDS - 1;
}

/**
 * The N most recent proposals closed at or before `asOfTs`, given a list
 * already sorted by `endTs` descending.
 *
 * Binary search rather than filter+sort: this runs once per delegate per
 * charted date, and re-sorting the full proposal list each time dominated the
 * recompute cost on a real roster.
 */
export function selectProposalWindow(
  sortedDesc: ProposalRow[],
  asOfTs: number,
  windowN: number,
): ProposalRow[] {
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDesc[mid]!.endTs <= asOfTs) hi = mid;
    else lo = mid + 1;
  }
  const n = Math.max(0, Math.floor(windowN));
  return sortedDesc.slice(lo, lo + n);
}

/**
 * Score a pre-selected proposal window. The single implementation of the
 * recency weighting — both entry points below funnel into it.
 */
export function scoreProposalWindow(
  window: ProposalRow[],
  votedIds: ReadonlySet<string>,
  asOfTs: number,
  halfLifeDays: number,
): VotesResult {
  if (window.length === 0) return { score: null, votedCount: 0, proposalCount: 0 };

  let num = 0;
  let den = 0;
  let votedCount = 0;

  for (const p of window) {
    const ageDays = (asOfTs - p.endTs) / DAY_SECONDS;
    const d = recencyWeight(ageDays, halfLifeDays);
    const voted = votedIds.has(p.id) ? 1 : 0;
    votedCount += voted;
    num += voted * d;
    den += d;
  }

  return {
    score: den > 0 ? (100 * num) / den : null,
    votedCount,
    proposalCount: window.length,
  };
}

/**
 * `votedIds` is the set of proposal ids the delegate voted on.
 *
 * Only proposals that had already closed as of `asOf` are considered — this is
 * what makes the as-of scrubber honest: a delegate is never penalised for a
 * proposal that had not happened yet.
 *
 * Sorts defensively; the pipeline uses `selectProposalWindow` on the
 * pre-sorted index instead.
 */
export function votesScore(
  proposals: ProposalRow[],
  votedIds: ReadonlySet<string>,
  asOf: string,
  opts: ScoringParams['votes'],
): VotesResult {
  const asOfTs = asOfTimestamp(asOf);
  const sortedDesc = [...proposals].sort((a, b) => b.endTs - a.endTs);
  const window = selectProposalWindow(sortedDesc, asOfTs, opts.windowN);
  return scoreProposalWindow(window, votedIds, asOfTs, opts.halfLifeDays);
}
