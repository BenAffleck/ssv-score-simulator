/**
 * Regression: the leaderboard used to favour delegates with no community data.
 *
 * Excluding a pillar per-delegate made "no data" strictly better than
 * "measured but low". The proposal's graceful degradation is pillar-level
 * ("any pillar whose *data source* is not configured"), not per-delegate.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../params.js';
import { indexDataset, simulate } from '../simulate.js';
import type { Dataset, ScoringParams } from '../types.js';
import { AS_OF, PROPOSALS, VOTED_LATEST_4, flatBalances } from './fixtures.js';

const HAS_DATA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NO_DATA = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** Two delegates, identical but for community: one scores 8, one has no profile. */
function dataset(): Dataset {
  return {
    generatedAt: new Date(0).toISOString(),
    space: 'mainnet.ssvnetwork.eth',
    dateRange: { start: '2025-11-22', end: AS_OF },
    delegates: [
      { address: HAS_DATA, forumHandle: 'has', discordUsername: '', displayName: 'HasProfile' },
      { address: NO_DATA, forumHandle: 'none', discordUsername: '', displayName: 'NoProfile' },
    ],
    balances: [...flatBalances(HAS_DATA, 2_500), ...flatBalances(NO_DATA, 2_500)],
    proposals: PROPOSALS,
    votes: [HAS_DATA, NO_DATA].flatMap((address) =>
      PROPOSALS.map((p) => ({
        address,
        proposalId: p.id,
        voted: (VOTED_LATEST_4.has(p.id) ? 1 : 0) as 0 | 1,
      })),
    ),
    // Only HasProfile appears in HighSignal, with a genuinely low score.
    highsignal: [
      { address: HAS_DATA, date: AS_OF, score: 8, hsUsername: 'has', hsRank: 56 },
    ],
  };
}

const index = indexDataset(dataset());
const scoreOf = (rows: ReturnType<typeof simulate>, name: string) =>
  rows.find((r) => r.displayName === name)!;

describe('a delegate with no community profile must not outrank one with a low score', () => {
  it('counts the missing pillar as 0 by default', () => {
    const rows = simulate(index, DEFAULT_PARAMS, AS_OF);
    const none = scoreOf(rows, 'NoProfile');

    expect(none.pillars.community).toBe(0);
    expect(none.missing.community).toBe(true); // imputed, and flagged as such
  });

  it('ranks the measured delegate above the one with no data', () => {
    const rows = simulate(index, DEFAULT_PARAMS, AS_OF);
    expect(scoreOf(rows, 'HasProfile').score!).toBeGreaterThan(scoreOf(rows, 'NoProfile').score!);
    expect(rows[0]!.displayName).toBe('HasProfile');
  });

  it('having a profile is never worse than lacking one, at any score', () => {
    for (const score of [0, 1, 8, 50, 100]) {
      const ds = dataset();
      ds.highsignal = [{ address: HAS_DATA, date: AS_OF, score, hsUsername: 'has', hsRank: 1 }];
      const rows = simulate(indexDataset(ds), DEFAULT_PARAMS, AS_OF);
      expect(scoreOf(rows, 'HasProfile').score!).toBeGreaterThanOrEqual(
        scoreOf(rows, 'NoProfile').score!,
      );
    }
  });

  it("the old 'exclude' behaviour reproduces the bug — kept as a demonstrable lever", () => {
    const excluded: ScoringParams = { ...DEFAULT_PARAMS, missingPolicy: 'exclude' };
    const rows = simulate(index, excluded, AS_OF);

    expect(scoreOf(rows, 'NoProfile').pillars.community).toBeNull();
    // This is precisely the reported defect: no data wins.
    expect(scoreOf(rows, 'NoProfile').score!).toBeGreaterThan(scoreOf(rows, 'HasProfile').score!);
  });
});

describe("pillar-level degradation still follows the proposal", () => {
  it('drops a pillar entirely when NO delegate has data for it', () => {
    const ds = dataset();
    ds.highsignal = []; // integration not live → excluded for everyone
    const rows = simulate(indexDataset(ds), DEFAULT_PARAMS, AS_OF);

    for (const row of rows) {
      expect(row.pillars.community).toBeNull(); // not zeroed
      expect(row.score).not.toBeNull();
    }
    // Score is the weighted average of the two live pillars only.
    const r = rows[0]!;
    expect(r.score).toBeCloseTo(
      (3 * r.pillars.holdings! + 10 * r.pillars.votes!) / 13,
      6,
    );
  });

  it('an unconfigured pillar does not penalise anyone, unlike a per-delegate gap', () => {
    const withSource = simulate(index, DEFAULT_PARAMS, AS_OF);
    const noSource = simulate(indexDataset({ ...dataset(), highsignal: [] }), DEFAULT_PARAMS, AS_OF);

    // NoProfile is punished when the pillar is live but they are absent from it,
    // and unaffected when the pillar is off for everybody.
    expect(scoreOf(noSource, 'NoProfile').score!).toBeGreaterThan(
      scoreOf(withSource, 'NoProfile').score!,
    );
  });

  it('a delegate absent from a live holdings pillar is zeroed, not excluded', () => {
    const ds = dataset();
    ds.balances = flatBalances(HAS_DATA, 2_500); // NoProfile has no balance rows
    const rows = simulate(indexDataset(ds), DEFAULT_PARAMS, AS_OF);
    const none = scoreOf(rows, 'NoProfile');

    expect(none.pillars.holdings).toBe(0);
    expect(none.missing.holdings).toBe(true);
  });
});
