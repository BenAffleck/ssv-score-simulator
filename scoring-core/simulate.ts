/**
 * Dataset → leaderboard, as of any date.
 *
 * This is the only place the three pillars are combined, and it is shared by
 * the UI and the collector so the math exists exactly once (SPEC §9).
 */
import { normalizeCommunity } from './community.js';
import { daysBetween } from './dates.js';
import { delegateScore } from './composite.js';
import {
  buildBalanceSeries,
  holdingsScore,
  twabAtOffset,
  twabWindowDays,
  type BalanceSample,
  type BalanceSeries,
} from './holdings.js';
import { asOfTimestamp, scoreProposalWindow, selectProposalWindow } from './votes.js';
import type {
  Dataset,
  HighSignalRow,
  LeaderboardRow,
  PillarScores,
  ProposalRow,
  ScoringParams,
} from './types.js';

export interface DatasetIndex {
  dataset: Dataset;
  /** Sorted by endTs descending — `selectProposalWindow` relies on it. */
  proposals: ProposalRow[];
  balances: Map<string, BalanceSample[]>;
  /** Densified daily balances + prefix sums, so TWAB is an O(1) query. */
  balanceSeries: Map<string, BalanceSeries>;
  /**
   * The days the collector actually covered, dataset-wide. Shared by every
   * delegate so nobody gains from having a shorter history.
   */
  balanceCoverage: { start: string; end: string } | null;
  voted: Map<string, Set<string>>;
  highsignal: Map<string, HighSignalRow[]>;
  /**
   * Non-canonical addresses of linked identities. A person may hold several eth
   * addresses (published on HighSignal); the first one that appears in the
   * roster is the canonical delegate and the rest are aliases, excluded from the
   * leaderboard so an identity is represented — and delegated to — exactly once.
   */
  aliases: Set<string>;
}

const key = (a: string): string => a.toLowerCase();

/** Union-find over the addresses HighSignal reports as one identity. */
function resolveAliases(dataset: Dataset): Set<string> {
  const identities = dataset.identities ?? [];
  if (identities.length === 0) return new Set();

  const parent = new Map<string, string>();
  const add = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    add(a);
    add(b);
    parent.set(find(a), find(b));
  };

  for (const id of identities) {
    add(key(id.address));
    for (const linked of id.linkedAddresses) union(key(id.address), key(linked));
  }

  // Canonical = the first delegate (in roster order) of each linked group.
  const canonicalByRoot = new Map<string, string>();
  const aliases = new Set<string>();
  for (const d of dataset.delegates) {
    const a = key(d.address);
    if (!parent.has(a)) continue;
    const root = find(a);
    if (canonicalByRoot.has(root)) aliases.add(a);
    else canonicalByRoot.set(root, a);
  }
  return aliases;
}

/** Build the lookup index once; reuse it across every parameter change. */
export function indexDataset(dataset: Dataset): DatasetIndex {
  const balances = new Map<string, BalanceSample[]>();
  let coverStart: string | null = null;
  let coverEnd: string | null = null;

  for (const b of dataset.balances) {
    const list = balances.get(key(b.address)) ?? [];
    list.push({ date: b.date, total: b.ssvErc20 + b.cssv });
    balances.set(key(b.address), list);
    if (coverStart === null || b.date < coverStart) coverStart = b.date;
    if (coverEnd === null || b.date > coverEnd) coverEnd = b.date;
  }
  for (const list of balances.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));

  const balanceCoverage = coverStart && coverEnd ? { start: coverStart, end: coverEnd } : null;
  const balanceSeries = new Map<string, BalanceSeries>();
  if (balanceCoverage) {
    for (const [address, samples] of balances) {
      const series = buildBalanceSeries(samples, balanceCoverage.start, balanceCoverage.end);
      if (series) balanceSeries.set(address, series);
    }
  }

  const voted = new Map<string, Set<string>>();
  for (const v of dataset.votes) {
    if (!v.voted) continue;
    const set = voted.get(key(v.address)) ?? new Set<string>();
    set.add(v.proposalId);
    voted.set(key(v.address), set);
  }

  const highsignal = new Map<string, HighSignalRow[]>();
  for (const h of dataset.highsignal) {
    const list = highsignal.get(key(h.address)) ?? [];
    list.push(h);
    highsignal.set(key(h.address), list);
  }
  for (const list of highsignal.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    dataset,
    proposals: [...dataset.proposals].sort((a, b) => b.endTs - a.endTs),
    balances,
    balanceSeries,
    balanceCoverage,
    voted,
    highsignal,
    aliases: resolveAliases(dataset),
  };
}

/**
 * Most recent HighSignal observation at or before `asOf` (no look-ahead).
 * Binary search over the ascending series — records now carry ~360 daily
 * points, so a linear scan here was a hot spot when charting.
 */
function communityAsOf(index: DatasetIndex, address: string, asOf: string): HighSignalRow | null {
  const list = index.highsignal.get(key(address));
  if (!list || list.length === 0) return null;

  let lo = 0;
  let hi = list.length - 1;
  let found: HighSignalRow | null = null;
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

export function simulate(index: DatasetIndex, params: ScoringParams, asOf: string): LeaderboardRow[] {
  // Aliases (non-canonical addresses of a linked identity) never become rows,
  // so a person appears — and is delegated to — exactly once.
  const delegates = index.aliases.size
    ? index.dataset.delegates.filter((d) => !index.aliases.has(key(d.address)))
    : index.dataset.delegates;

  // Pass 1 — raw community values, needed up front for min–max normalization.
  const rawCommunity = new Map<string, HighSignalRow | null>();
  for (const d of delegates) rawCommunity.set(key(d.address), communityAsOf(index, d.address, asOf));

  const present = [...rawCommunity.values()].filter((r): r is HighSignalRow => r !== null);
  const ctx = present.length
    ? {
        min: Math.min(...present.map((r) => r.score)),
        max: Math.max(...present.map((r) => r.score)),
      }
    : undefined;

  // The proposal window and the balance-series offset are identical for every
  // delegate, so resolve both once rather than per row.
  const asOfTs = asOfTimestamp(asOf);
  const proposalWindow = selectProposalWindow(index.proposals, asOfTs, params.votes.windowN);
  const balanceOffset = index.balanceCoverage
    ? Math.round(daysBetween(index.balanceCoverage.start, asOf))
    : -1;

  // Pass 2 — raw pillar values, before any missing-data policy is applied.
  const computed = delegates.map((d) => {
    const addr = key(d.address);

    const hs = rawCommunity.get(addr) ?? null;
    const community = hs ? normalizeCommunity(hs.score, params.community, ctx) : null;

    const series = index.balanceSeries.get(addr) ?? null;
    const twabValue = twabAtOffset(series, balanceOffset, params.holdings.windowDays);
    const holdings = twabValue === null ? null : holdingsScore(twabValue, params.holdings);

    const votes = scoreProposalWindow(
      proposalWindow,
      index.voted.get(addr) ?? new Set<string>(),
      asOfTs,
      params.votes.halfLifeDays,
    );

    return {
      d,
      hs,
      twabValue,
      twabDays: twabWindowDays(series, balanceOffset, params.holdings.windowDays),
      votes,
      pillars: { community, holdings, votes: votes.score },
    };
  });

  /**
   * Pillar-level coverage. A pillar nobody has data for is not configured /
   * not live, so it is excluded for everyone — the proposal's graceful
   * degradation, which is explicitly about the *data source*, not about an
   * individual delegate.
   *
   * A pillar SOME delegates have data for is live; a delegate missing from it
   * is a gap in that delegate, and is handled by `missingPolicy`. Excluding it
   * per-delegate would make missing data outrank a genuine low score.
   */
  const covered = {
    community: computed.some((c) => c.pillars.community !== null),
    holdings: computed.some((c) => c.pillars.holdings !== null),
    votes: computed.some((c) => c.pillars.votes !== null),
  };

  const impute = params.missingPolicy === 'zero' ? 0 : null;
  const resolve = (value: number | null, pillarCovered: boolean): number | null =>
    value !== null ? value : pillarCovered ? impute : null;

  const rows: LeaderboardRow[] = computed.map(({ d, hs, twabValue, twabDays, votes, pillars }) => {
    const resolved: PillarScores = {
      community: resolve(pillars.community, covered.community),
      holdings: resolve(pillars.holdings, covered.holdings),
      votes: resolve(pillars.votes, covered.votes),
    };

    return {
      address: d.address,
      displayName: d.displayName || d.forumHandle || d.address,
      forumHandle: d.forumHandle,
      score: delegateScore(resolved, params.weights),
      pillars: resolved,
      missing: {
        community: pillars.community === null,
        holdings: pillars.holdings === null,
        votes: pillars.votes === null,
      },
      raw: {
        twab: twabValue,
        twabDays,
        communityRaw: hs?.score ?? null,
        votedCount: votes.votedCount,
        proposalCount: votes.proposalCount,
        hsUsername: hs?.hsUsername ?? null,
        hsRank: hs?.hsRank ?? null,
      },
    };
  });

  // Address break makes the ranking deterministic: scores tie often once a
  // pillar is imputed, and an unstable order would reshuffle rows on every
  // slider move.
  return rows.sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.address.localeCompare(b.address),
  );
}

export interface SeriesPoint {
  date: string;
  [address: string]: string | number | null;
}

/** DelegateScore per delegate across `dates` — the time-series chart feed. */
export function scoreSeries(
  index: DatasetIndex,
  params: ScoringParams,
  dates: string[],
): SeriesPoint[] {
  return dates.map((date) => {
    const point: SeriesPoint = { date };
    for (const row of simulate(index, params, date)) {
      point[row.address.toLowerCase()] = row.score === null ? null : round2(row.score);
    }
    return point;
  });
}

export const round2 = (x: number): number => Math.round(x * 100) / 100;
