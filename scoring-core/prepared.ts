/**
 * Lookup structures built once per dataset and reused across every parameter
 * change and as-of. Building them is the only O(dataset) work; scoring one
 * as-of then touches each roster address once.
 */
import { daysBetween } from './dates.js';
import type { Candidate, CommunityObservation, Dataset, Proposal } from './types.js';

export interface Prepared {
  dataset: Dataset;
  roster: Candidate[];
  /** Ordered newest first, then by id — production's window order. */
  proposals: Proposal[];
  /** Voter → proposal id → when the vote was cast. */
  votes: Map<string, Map<string, number>>;
  /** Address → observations, oldest first. */
  community: Map<string, CommunityObservation[]>;
  /** The first and last day balances were collected, or null when none were. */
  coverage: { start: string; end: string } | null;
  /** Sorted collected days, to find the last one on or before an as-of. */
  balanceDates: string[];
  /**
   * Address → held amount on each calendar day from `coverage.start`, carried
   * forward over uncollected days; NaN before the address's first collected day.
   */
  held: Map<string, Float64Array>;
}

export function prepare(dataset: Dataset): Prepared {
  const proposals = [...dataset.proposals].sort((a, b) => b.end - a.end || cmp(a.id, b.id));

  const votes = new Map<string, Map<string, number>>();
  for (const v of dataset.votes) {
    let byProposal = votes.get(v.voter);
    if (!byProposal) votes.set(v.voter, (byProposal = new Map()));
    byProposal.set(v.proposalId, v.created);
  }

  const community = new Map<string, CommunityObservation[]>();
  for (const o of dataset.community) {
    const list = community.get(o.address) ?? [];
    list.push(o);
    community.set(o.address, list);
  }
  for (const list of community.values()) list.sort((a, b) => cmp(a.date, b.date));

  const balanceDates = [...dataset.balanceDates].sort(cmp);
  const coverage =
    balanceDates.length > 0 ? { start: balanceDates[0]!, end: balanceDates.at(-1)! } : null;
  const held = new Map<string, Float64Array>();
  if (coverage) {
    const days = daysBetween(coverage.start, coverage.end) + 1;
    for (const series of dataset.balances) {
      const values = new Float64Array(days).fill(NaN);
      let i = 0;
      let current = NaN;
      for (let day = 0; day < days; day++) {
        while (i < series.changes.length && offset(coverage.start, series.changes[i]![0]) <= day) {
          current = series.changes[i]![1];
          i++;
        }
        values[day] = current;
      }
      held.set(series.address, values);
    }
  }

  return { dataset, roster: dataset.roster, proposals, votes, community, coverage, balanceDates, held };
}

function offset(start: string, date: string): number {
  return daysBetween(start, date);
}

/** Code-point order, as Python compares strings. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
