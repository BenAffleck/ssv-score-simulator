/**
 * Dataset + params → one ranked row per roster address, as of a day. A port of
 * production's `scoring/composite.py` and `scoring/score.py`.
 */
import { cmp, type Prepared } from './prepared.js';
import { communityPillar, holdingsPillar, votesPillar } from './pillars.js';
import { pySum } from './pysum.js';
import { PILLARS, type Params, type Pillar, type Row } from './types.js';

export interface Composite {
  score: number | null;
  pillars: Record<Pillar, number | null>;
  missing: Set<Pillar>;
}

/**
 * Weighted average over live pillars with weight > 0.
 *
 * A pillar is live when anyone has data for it. An address missing from a live
 * pillar scores 0 there and is flagged. A pillar that is not live is null for
 * everyone — the proposal's graceful degradation.
 */
export function combine(
  roster: readonly string[],
  pillars: Record<Pillar, Map<string, number>>,
  weights: Params['weights'],
): Map<string, Composite> {
  const live = PILLARS.filter((pillar) => pillars[pillar].size > 0);
  const counted = live.filter((pillar) => weights[pillar] > 0);
  const total = pySum(counted.map((pillar) => weights[pillar]));
  const result = new Map<string, Composite>();
  for (const address of roster) {
    const values: Record<Pillar, number | null> = { community: null, holdings: null, votes: null };
    const missing = new Set<Pillar>();
    for (const pillar of live) {
      const value = pillars[pillar].get(address);
      if (value === undefined) missing.add(pillar);
      values[pillar] = value ?? 0;
    }
    const score =
      counted.length > 0
        ? pySum(counted.map((pillar) => weights[pillar] * (values[pillar] ?? 0))) / total
        : null;
    result.set(address, { score, pillars: values, missing });
  }
  return result;
}

/** Score every roster address on its own data, ranked by score desc then address. */
export function evaluate(
  p: Prepared,
  params: Params,
  asOf: string,
  include: (address: string) => boolean = () => true,
): Row[] {
  const roster = p.roster.filter((c) => include(c.address));
  const addresses = roster.map((c) => c.address);
  const community = communityPillar(p, addresses, params.community, asOf);
  const holdings = holdingsPillar(p, addresses, params.holdings, asOf);
  const votes = votesPillar(p, addresses, params.votes, asOf);
  const composites = combine(
    addresses,
    {
      community: mapValues(community, (c) => c.score),
      holdings: mapValues(holdings, (h) => h.score),
      votes: mapValues(votes, (v) => v.score),
    },
    params.weights,
  );

  const rows: Row[] = roster.map((candidate) => {
    const composite = composites.get(candidate.address)!;
    const observed = community.get(candidate.address);
    const held = holdings.get(candidate.address);
    const vote = votes.get(candidate.address);
    const hs = observed?.observation ?? null;
    return {
      address: candidate.address,
      displayName: candidate.displayName,
      rank: null,
      score: composite.score,
      community: composite.pillars.community,
      holdings: composite.pillars.holdings,
      votes: composite.pillars.votes,
      missing: {
        community: composite.missing.has('community'),
        holdings: composite.missing.has('holdings'),
        votes: composite.missing.has('votes'),
      },
      twab: held?.twab ?? null,
      twabDays: held?.twabDays ?? null,
      communityRaw: hs?.score ?? null,
      votedCount: vote?.votedCount ?? null,
      proposalCount: vote?.proposalCount ?? null,
      hsUsername: hs?.hsUsername ?? null,
      hsRank: hs?.hsRank ?? null,
    };
  });
  return rank(rows);
}

/** Order by score descending, then address ascending. Unscored rows come last, unranked. */
export function rank(rows: Row[]): Row[] {
  const scored = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score! - a.score! || cmp(a.address, b.address));
  const unscored = rows.filter((r) => r.score === null).sort((a, b) => cmp(a.address, b.address));
  return [
    ...scored.map((r, i) => ({ ...r, rank: i + 1 })),
    ...unscored.map((r) => ({ ...r, rank: null })),
  ];
}

function mapValues<T>(map: Map<string, T>, f: (value: T) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of map) out.set(k, f(v));
  return out;
}
