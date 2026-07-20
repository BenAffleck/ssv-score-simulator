/** Shared fixtures reproducing the proposal's worked example. */
import { DAY_SECONDS, dateToTs } from '../dates.js';
import type { BalanceRow, Dataset, ProposalRow } from '../types.js';

export const AS_OF = '2026-06-30';

/**
 * Five closed proposals spaced 30 days apart, newest first.
 *
 * The proposal states 4-of-5 (oldest missed, H=90) → 88 and cross-checks that
 * missing the *newest* instead gives ~70. 30-day spacing is the spacing that
 * satisfies both (88.05 and 69.88); the absolute anchor is irrelevant since a
 * uniform shift scales numerator and denominator alike.
 */
export const PROPOSALS: ProposalRow[] = [0, 1, 2, 3, 4].map((i) => ({
  id: `p${i}`,
  title: `Proposal ${i}`,
  endTs: dateToTs(AS_OF) - i * 30 * DAY_SECONDS,
}));

export const NEWEST = 'p0';
export const OLDEST = 'p4';

/** Alice voted on the latest 4 of 5 — she missed the oldest. */
export const VOTED_LATEST_4 = new Set(['p0', 'p1', 'p2', 'p3']);
/** Same count, but the most recent was skipped. */
export const VOTED_OLDEST_4 = new Set(['p1', 'p2', 'p3', 'p4']);

/**
 * A flat balance history totalling `total` per day, deliberately split across
 * both components so the sum proves cSSV is counted 1:1 with SSV.
 */
export function flatBalances(address: string, total: number, days = 220): BalanceRow[] {
  const rows: BalanceRow[] = [];
  for (let i = 0; i < days; i++) {
    rows.push({
      address,
      date: new Date((dateToTs(AS_OF) - i * DAY_SECONDS) * 1000).toISOString().slice(0, 10),
      ssvErc20: total * 0.6,
      cssv: total * 0.4,
    });
  }
  return rows;
}

/** Alice (TWAB 2,500) and Whale (TWAB 1,000,000), otherwise identical. */
export function workedExampleDataset(): Dataset {
  const alice = '0xAAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA';
  const whale = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';

  return {
    generatedAt: new Date(0).toISOString(),
    space: 'mainnet.ssvnetwork.eth',
    dateRange: { start: '2025-11-22', end: AS_OF },
    delegates: [
      { address: alice, forumHandle: 'alice', discordUsername: 'alice#1', displayName: 'Alice' },
      { address: whale, forumHandle: 'whale', discordUsername: 'whale#1', displayName: 'Whale' },
    ],
    balances: [...flatBalances(alice, 2_500), ...flatBalances(whale, 1_000_000)],
    proposals: PROPOSALS,
    votes: [
      ...[...VOTED_LATEST_4].map((id) => ({ address: alice, proposalId: id, voted: 1 as const })),
      { address: alice, proposalId: OLDEST, voted: 0 as const },
      ...[...VOTED_LATEST_4].map((id) => ({ address: whale, proposalId: id, voted: 1 as const })),
      { address: whale, proposalId: OLDEST, voted: 0 as const },
    ],
    highsignal: [
      { address: alice, date: AS_OF, score: 82, hsUsername: 'alice', hsRank: 4 },
      { address: whale, date: AS_OF, score: 82, hsUsername: 'whale', hsRank: 5 },
    ],
  };
}
