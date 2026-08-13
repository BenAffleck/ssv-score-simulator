/**
 * Delegation impact analysis — cohort membership resolution and equal-split
 * power allocation. These pin the policy rules: manual-cohort exclusivity,
 * exclusion from SSV/ETH, the score threshold, ETH dedupe/collision handling,
 * minimum-nomination warnings, and the reserve when percentages sum below 100.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DELEGATION, cloneDelegation } from '../params.js';
import { computeDelegation, type DelegationConfig } from '../delegation.js';
import type { EthCommunityRow, LeaderboardRow } from '../types.js';

/** Minimal leaderboard row — only address + score drive cohort membership. */
function row(address: string, score: number | null): LeaderboardRow {
  return {
    address,
    displayName: address,
    forumHandle: '',
    score,
    pillars: { community: score, holdings: score, votes: score },
    missing: { community: false, holdings: false, votes: false },
    raw: {
      twab: null,
      twabDays: 0,
      communityRaw: null,
      votedCount: 0,
      proposalCount: 0,
      hsUsername: null,
      hsRank: null,
    },
  };
}

function config(patch: Partial<DelegationConfig> = {}): DelegationConfig {
  // Uncapped unless a test says otherwise, so the pre-cap allocation rules are
  // still pinned by exactly the numbers they were written against.
  return {
    ...cloneDelegation(DEFAULT_DELEGATION),
    totalDelegatable: 100_000,
    powerCap: null,
    ...patch,
  };
}

const summary = (r: ReturnType<typeof computeDelegation>, cohort: string) =>
  r.cohorts.find((c) => c.cohort === cohort)!;

describe('computeDelegation — SSV Community', () => {
  it('splits the budget equally among entities scoring above the threshold', () => {
    const rows = [row('0xa', 80), row('0xb', 40), row('0xc', 26)]; // all > 25
    const r = computeDelegation(rows, config(), []);
    const ssv = summary(r, 'ssvCommunity');
    expect(ssv.budget).toBe(45_000); // 45% of 100k
    expect(ssv.memberCount).toBe(3);
    expect(ssv.perMember).toBe(15_000);
    expect(r.perEntity.get('0xa')).toEqual({ power: 15_000, cohort: 'ssvCommunity' });
  });

  it('excludes entities at or below the (configurable) score threshold', () => {
    const rows = [row('0xa', 25), row('0xb', 25.0001), row('0xc', null)];
    // Threshold pinned here, not inherited: this pins the strictly-greater-than
    // boundary, which must hold whatever the ratified default happens to be.
    const r = computeDelegation(rows, config({ ssvCommunity: { pct: 45, scoreThreshold: 25 } }), []);
    expect(summary(r, 'ssvCommunity').memberCount).toBe(1); // only 0xb
    expect(r.perEntity.has('0xa')).toBe(false);
    expect(r.perEntity.has('0xc')).toBe(false);
  });
});

describe('computeDelegation — manual cohorts', () => {
  it('routes an assigned entity to its cohort and out of SSV Community', () => {
    const rows = [row('0xa', 80), row('0xb', 80), row('0xc', 80)];
    const r = computeDelegation(rows, config({ assignments: { '0xa': 'verifiedOperators' } }), []);
    expect(r.perEntity.get('0xa')).toEqual({
      power: 25_000, // sole member of a 25% (=25k) cohort
      cohort: 'verifiedOperators',
    });
    expect(summary(r, 'ssvCommunity').memberCount).toBe(2); // 0xb, 0xc only
    expect(summary(r, 'verifiedOperators').memberCount).toBe(1);
  });

  it('ignores an assignment for an address not on the leaderboard', () => {
    const rows = [row('0xa', 80)];
    const r = computeDelegation(rows, config({ assignments: { '0xzz': 'professional' } }), []);
    expect(summary(r, 'professional').memberCount).toBe(0);
    expect(summary(r, 'ssvCommunity').memberCount).toBe(1);
  });
});

describe('computeDelegation — Ethereum Communities', () => {
  const eth = (address: string): EthCommunityRow => ({ address, project: 'other', hsUsername: null });

  it('assigns roster delegates whose address is in an ETH community to the cohort', () => {
    const rows = [row('0xe1', 10), row('0xe2', null), row('0xa', 80)];
    const r = computeDelegation(rows, config(), [eth('0xe1'), eth('0xE1'), eth('0xe2')]);
    const ethCohort = summary(r, 'ethCommunities');
    expect(ethCohort.memberCount).toBe(2); // 0xe1, 0xe2 (deduped, case-insensitive)
    expect(ethCohort.perMember).toBe(2_500); // 5% of 100k / 2
    expect(r.perEntity.get('0xe1')).toEqual({ power: 2_500, cohort: 'ethCommunities' });
    expect(r.perEntity.get('0xe2')?.cohort).toBe('ethCommunities'); // included despite null score
  });

  it('routes an ETH member above the SSV threshold to SSV Community (SSV precedence)', () => {
    const rows = [row('0xe1', 90)];
    const r = computeDelegation(rows, config(), [eth('0xe1')]);
    expect(summary(r, 'ssvCommunity').memberCount).toBe(1);
    expect(summary(r, 'ethCommunities').memberCount).toBe(0);
    expect(r.perEntity.get('0xe1')?.cohort).toBe('ssvCommunity');
  });

  it('lets a manual assignment win over ETH membership (one cohort per delegate)', () => {
    const rows = [row('0xa', 80)];
    const r = computeDelegation(rows, config({ assignments: { '0xa': 'grantRecipients' } }), [eth('0xa')]);
    expect(summary(r, 'ethCommunities').memberCount).toBe(0);
    expect(r.perEntity.get('0xa')?.cohort).toBe('grantRecipients');
  });
});

describe('computeDelegation — explicit cohort pins', () => {
  const eth = (address: string): EthCommunityRow => ({ address, project: 'other', hsUsername: null });

  it('pins a delegate to SSV Community, overriding ETH auto-membership', () => {
    const rows = [row('0xe1', 5)]; // low score, but sourced from an ETH community
    const r = computeDelegation(rows, config({ assignments: { '0xe1': 'ssvCommunity' } }), [eth('0xe1')]);
    expect(r.perEntity.get('0xe1')?.cohort).toBe('ssvCommunity');
    expect(summary(r, 'ethCommunities').memberCount).toBe(0);
  });

  it('pins a delegate to Ethereum Communities, overriding SSV auto-membership', () => {
    const rows = [row('0xa', 80)]; // would auto-derive to SSV Community
    const r = computeDelegation(rows, config({ assignments: { '0xa': 'ethCommunities' } }), []);
    expect(r.perEntity.get('0xa')?.cohort).toBe('ethCommunities');
    expect(summary(r, 'ssvCommunity').memberCount).toBe(0);
  });
});

describe('computeDelegation — minimum nominations', () => {
  it('warns below the minimum but still allocates', () => {
    const rows = [row('0xa', 80), row('0xb', 80)];
    const r = computeDelegation(
      rows,
      config({ assignments: { '0xa': 'verifiedOperators' } }), // min 5, only 1
      [],
    );
    const vops = summary(r, 'verifiedOperators');
    expect(vops.warning).toMatch(/1 of 5/);
    expect(vops.perMember).toBe(25_000); // still calculated
    expect(r.warnings.some((w) => w.includes('Verified Operators'))).toBe(true);
  });

  it('is silent once the minimum is met', () => {
    const cfg = config({
      verifiedOperators: { pct: 20, minMembers: 2 },
      assignments: { '0xa': 'verifiedOperators', '0xb': 'verifiedOperators' },
    });
    const r = computeDelegation([row('0xa', 80), row('0xb', 80)], cfg, []);
    expect(summary(r, 'verifiedOperators').warning).toBeUndefined();
  });
});

describe('computeDelegation — program cap', () => {
  it('splits only the capped pool and voids the excess', () => {
    const rows = [row('0xa', 80), row('0xb', 80)];
    const r = computeDelegation(rows, config({ totalDelegatable: 500_000, powerCap: 200_000 }), []);
    expect(r.delegated).toBe(500_000);
    expect(r.effective).toBe(200_000);
    expect(r.voided).toBe(300_000);
    // 45% of the CAP, not of the 500k delegated.
    expect(summary(r, 'ssvCommunity').budget).toBe(90_000);
    expect(r.perEntity.get('0xa')?.power).toBe(45_000);
  });

  it('voids the excess rather than holding it in reserve', () => {
    const rows = [row('0xa', 80)];
    const r = computeDelegation(rows, config({ totalDelegatable: 500_000, powerCap: 200_000 }), []);
    // Only SSV Community has members, so 90k of the 200k cap is allocated and
    // 110k is reserve. The 300k above the cap is gone — not added to it.
    expect(r.totalAllocated).toBe(90_000);
    expect(r.unallocated).toBe(110_000);
    expect(r.unallocated + r.totalAllocated).toBe(r.effective);
  });

  it('leaves allocation untouched when the cap is not binding', () => {
    const rows = [row('0xa', 80), row('0xb', 80)];
    const capped = computeDelegation(rows, config({ powerCap: 250_000 }), []);
    const uncapped = computeDelegation(rows, config(), []);
    expect(capped.voided).toBe(0);
    expect(capped.warnings.some((w) => /cap/i.test(w))).toBe(false);
    expect(capped.cohorts).toEqual(uncapped.cohorts);
  });

  it('warns whenever the cap actually voids power', () => {
    const r = computeDelegation([row('0xa', 80)], config({ powerCap: 40_000 }), []);
    expect(r.warnings.some((w) => /cap/i.test(w) && /void/i.test(w))).toBe(true);
  });

  it('distributes nothing at a zero cap, and everything when uncapped', () => {
    const rows = [row('0xa', 80)];
    const zero = computeDelegation(rows, config({ powerCap: 0 }), []);
    expect(zero.effective).toBe(0);
    expect(zero.voided).toBe(100_000);
    expect(zero.perEntity.get('0xa')?.power).toBe(0);

    const none = computeDelegation(rows, config({ powerCap: null }), []);
    expect(none.cap).toBeNull();
    expect(none.effective).toBe(100_000);
    expect(none.voided).toBe(0);
  });

  it('ships a cap with headroom over the ratified pool, so it voids nothing today', () => {
    // The shipped cap (750k) is 3.75× the ratified pool (200k): adopting it
    // moves nothing, and it only binds once the program has nearly quadrupled.
    const cfg = cloneDelegation(DEFAULT_DELEGATION);
    const r = computeDelegation([row('0xa', 80)], cfg, []);
    expect(cfg.powerCap).toBe(750_000);
    expect(r.voided).toBe(0);
    expect(r.effective).toBe(DEFAULT_DELEGATION.totalDelegatable);

    // …and it does bind above that, rather than being decorative.
    const grown = computeDelegation([row('0xa', 80)], { ...cfg, totalDelegatable: 900_000 }, []);
    expect(grown.effective).toBe(750_000);
    expect(grown.voided).toBe(150_000);
  });
});

describe('computeDelegation — reserve', () => {
  it('reports the unallocated remainder when percentages sum below 100', () => {
    const cfg = config({
      ssvCommunity: { pct: 30, scoreThreshold: 25 },
      verifiedOperators: { pct: 20, minMembers: 5 },
      professional: { pct: 20, minMembers: 1 },
      grantRecipients: { pct: 10, minMembers: 5 }, // 10 instead of 20 → 10% reserve
      ethCommunities: { pct: 10 },
    });
    const r = computeDelegation([row('0xa', 80)], cfg, []);
    // Only SSV Community has members here, so its 30k is allocated; the rest of D
    // (empty cohorts + the 10% shortfall) is unallocated.
    expect(r.totalAllocated).toBe(30_000);
    expect(r.unallocated).toBe(70_000);
  });
});
