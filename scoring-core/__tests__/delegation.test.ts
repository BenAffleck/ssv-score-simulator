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
  return { ...cloneDelegation(DEFAULT_DELEGATION), totalDelegatable: 100_000, ...patch };
}

const summary = (r: ReturnType<typeof computeDelegation>, cohort: string) =>
  r.cohorts.find((c) => c.cohort === cohort)!;

describe('computeDelegation — SSV Community', () => {
  it('splits the budget equally among entities scoring above the threshold', () => {
    const rows = [row('0xa', 80), row('0xb', 40), row('0xc', 26)]; // all > 25
    const r = computeDelegation(rows, config(), []);
    const ssv = summary(r, 'ssvCommunity');
    expect(ssv.budget).toBe(30_000); // 30% of 100k
    expect(ssv.memberCount).toBe(3);
    expect(ssv.perMember).toBe(10_000);
    expect(r.perEntity.get('0xa')).toEqual({ power: 10_000, cohort: 'ssvCommunity' });
  });

  it('excludes entities at or below the (configurable) score threshold', () => {
    const rows = [row('0xa', 25), row('0xb', 25.0001), row('0xc', null)];
    const r = computeDelegation(rows, config(), []);
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
      power: 20_000, // sole member of a 20% (=20k) cohort
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
    expect(ethCohort.perMember).toBe(5_000); // 10% of 100k / 2
    expect(r.perEntity.get('0xe1')).toEqual({ power: 5_000, cohort: 'ethCommunities' });
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
    expect(vops.perMember).toBe(20_000); // still calculated
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
