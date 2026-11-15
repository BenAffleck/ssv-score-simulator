/**
 * The three pillars, ported line for line from the production pipeline
 * (ssv-scoring `scoring/community.py`, `holdings.py`, `votes.py`). Each returns
 * a sub-score only for the addresses it has data for; `combine` decides what a
 * missing one means.
 */
import { addDays, DAY_SECONDS, daysBetween, endOfDay } from './dates.js';
import type { Prepared } from './prepared.js';
import { pow } from './pow.js';
import { pySum } from './pysum.js';
import type { CommunityObservation, Params } from './types.js';

export interface CommunityScore {
  score: number;
  observation: CommunityObservation;
}

/**
 * Community sub-score per roster address with an observation on or before the
 * as-of: `100 · clamp(hs / ref, 0, 1)` over the latest such observation.
 */
export function communityPillar(
  p: Prepared,
  addresses: readonly string[],
  params: Params['community'],
  asOf: string,
): Map<string, CommunityScore> {
  const result = new Map<string, CommunityScore>();
  for (const address of addresses) {
    const o = latestOnOrBefore(p.community.get(address), asOf);
    if (o) {
      result.set(address, {
        score: 100 * Math.min(1, Math.max(0, o.score / params.ref)),
        observation: o,
      });
    }
  }
  return result;
}

function latestOnOrBefore(
  list: CommunityObservation[] | undefined,
  asOf: string,
): CommunityObservation | null {
  if (!list) return null;
  let lo = 0;
  let hi = list.length - 1;
  let found: CommunityObservation | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.date <= asOf) {
      found = list[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface HoldingsScore {
  score: number;
  twab: number;
  twabDays: number;
}

/**
 * Holdings sub-score per roster address with a balance on or before the as-of.
 *
 * The window is the `windowDays` days ending at the as-of, or at the last
 * collected day when collection stopped earlier, intersected with the coverage:
 * the collected days of the whole dataset. On each window day an address holds
 * its latest balance on or before it, or 0 before its first. The sub-score is
 * `100 · min(1, (TWAB / ref) ^ concavity)`.
 */
export function holdingsPillar(
  p: Prepared,
  addresses: readonly string[],
  params: Params['holdings'],
  asOf: string,
): Map<string, HoldingsScore> {
  const result = new Map<string, HoldingsScore>();
  const end = lastOnOrBefore(p.balanceDates, asOf);
  if (end === null || !p.coverage) return result;
  const start = maxDate(addDays(end, -(params.windowDays - 1)), p.coverage.start);
  const days = daysBetween(start, end) + 1;
  const from = daysBetween(p.coverage.start, start);
  const endIndex = daysBetween(p.coverage.start, end);
  for (const address of addresses) {
    const held = p.held.get(address);
    // No balance on or before the as-of: unmeasured, not a measured 0.
    if (!held || Number.isNaN(held[endIndex]!)) continue;
    const daily = new Array<number>(days);
    for (let i = 0; i < days; i++) {
      const value = held[from + i]!;
      daily[i] = Number.isNaN(value) ? 0 : value;
    }
    const twab = pySum(daily) / days;
    result.set(address, {
      score: 100 * Math.min(1, pow(twab / params.ref, params.concavity)),
      twab,
      twabDays: days,
    });
  }
  return result;
}

function lastOnOrBefore(sorted: string[], asOf: string): string | null {
  let lo = 0;
  let hi = sorted.length - 1;
  let found: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= asOf) {
      found = sorted[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

const maxDate = (a: string, b: string): string => (a > b ? a : b);

export interface VotesScore {
  score: number;
  votedCount: number;
  proposalCount: number;
}

/**
 * Votes sub-score per roster address; empty when no proposal had closed by the
 * as-of. The window holds the N latest proposals closed before the as-of ends.
 * Each weighs `0.5 ^ (age / halfLife)`, age measured from the end of the as-of.
 * A vote counts only if it was cast before the as-of ended.
 */
export function votesPillar(
  p: Prepared,
  addresses: readonly string[],
  params: Params['votes'],
  asOf: string,
): Map<string, VotesScore> {
  const result = new Map<string, VotesScore>();
  const cutoff = endOfDay(asOf);
  const window = [];
  for (const proposal of p.proposals) {
    if (proposal.end < cutoff) window.push(proposal);
    if (window.length >= params.windowN) break;
  }
  if (window.length === 0) return result;
  const decay = window.map((w) => pow(0.5, (cutoff - w.end) / DAY_SECONDS / params.halfLifeDays));
  const total = pySum(decay);
  for (const address of addresses) {
    const cast = p.votes.get(address);
    const counted: number[] = [];
    if (cast) {
      for (let i = 0; i < window.length; i++) {
        const created = cast.get(window[i]!.id);
        if (created !== undefined && created < cutoff) counted.push(decay[i]!);
      }
    }
    const voted = counted.length;
    result.set(address, {
      score: (100 * pySum(counted)) / total,
      votedCount: voted,
      proposalCount: window.length,
    });
  }
  return result;
}
