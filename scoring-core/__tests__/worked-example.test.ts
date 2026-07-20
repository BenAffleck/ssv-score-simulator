/**
 * Acceptance §1 — reproduce the proposal's worked example end to end.
 *   community 82, TWAB 2500 → holdings 50, latest 4 of 5 (H=90) → votes ≈ 88,
 *   DelegateScore ≈ 80; whale TWAB 1,000,000 → holdings 100.
 */
import { describe, expect, it } from 'vitest';
import { normalizeCommunity } from '../community.js';
import { delegateScore } from '../composite.js';
import { holdingsScore } from '../holdings.js';
import { DEFAULT_PARAMS } from '../params.js';
import { indexDataset, simulate } from '../simulate.js';
import { votesScore } from '../votes.js';
import {
  AS_OF,
  PROPOSALS,
  VOTED_LATEST_4,
  VOTED_OLDEST_4,
  workedExampleDataset,
} from './fixtures.js';

const P = DEFAULT_PARAMS;

describe('worked example — pillar by pillar', () => {
  it('Community: HighSignal 82 is already 0–100 → 82', () => {
    expect(normalizeCommunity(82, P.community)).toBe(82);
  });

  it('Holdings: TWAB 2,500 against HOLD_REF 10,000 → 50', () => {
    expect(holdingsScore(2_500, P.holdings)).toBeCloseTo(50, 10);
  });

  it('Votes: latest 4 of 5, oldest missed, H=90 → ≈88', () => {
    const { score } = votesScore(PROPOSALS, VOTED_LATEST_4, AS_OF, P.votes);
    expect(score).toBeCloseTo(88.05, 2);
    expect(Math.round(score!)).toBe(88);
  });

  it('DelegateScore ≈ 80', () => {
    const votes = votesScore(PROPOSALS, VOTED_LATEST_4, AS_OF, P.votes).score;
    const score = delegateScore(
      { community: 82, holdings: holdingsScore(2_500, P.holdings), votes },
      P.weights,
    );
    expect(score).toBeCloseTo(79.78, 2);
    expect(Math.round(score!)).toBe(80);
  });
});

describe('whale case', () => {
  it('TWAB 1,000,000 → holdings capped at 100', () => {
    expect(holdingsScore(1_000_000, P.holdings)).toBe(100);
  });

  it('400× the stake buys under ten points of DelegateScore', () => {
    const votes = votesScore(PROPOSALS, VOTED_LATEST_4, AS_OF, P.votes).score;
    const alice = delegateScore({ community: 82, holdings: 50, votes }, P.weights)!;
    const whale = delegateScore({ community: 82, holdings: 100, votes }, P.weights)!;
    expect(whale - alice).toBeCloseTo((3 * 50) / 16, 6); // ≈ 9.375
    expect(whale - alice).toBeLessThan(10);
  });
});

describe('recency actually bites', () => {
  it('skipping the most recent of 5 scores ~70, not 88', () => {
    const { score } = votesScore(PROPOSALS, VOTED_OLDEST_4, AS_OF, P.votes);
    expect(score).toBeCloseTo(69.88, 2);
    expect(Math.round(score!)).toBe(70);
  });

  it('same 4-of-5 count, ~18 points apart — flat counting would tie at 80', () => {
    const newestKept = votesScore(PROPOSALS, VOTED_LATEST_4, AS_OF, P.votes).score!;
    const newestMissed = votesScore(PROPOSALS, VOTED_OLDEST_4, AS_OF, P.votes).score!;
    expect(newestKept - newestMissed).toBeGreaterThan(15);
  });
});

describe('end to end through simulate()', () => {
  const index = indexDataset(workedExampleDataset());

  it('produces Alice = 80 from the dataset, with cSSV summed into TWAB at parity', () => {
    const rows = simulate(index, P, AS_OF);
    const alice = rows.find((r) => r.displayName === 'Alice')!;

    expect(alice.raw.twab).toBeCloseTo(2_500, 6);
    expect(alice.pillars.community).toBe(82);
    expect(alice.pillars.holdings).toBeCloseTo(50, 6);
    expect(alice.pillars.votes).toBeCloseTo(88.05, 2);
    expect(Math.round(alice.score!)).toBe(80);
  });

  it('ranks the whale first, but only by ~9 points', () => {
    const rows = simulate(index, P, AS_OF);
    expect(rows[0]!.displayName).toBe('Whale');
    expect(rows[0]!.pillars.holdings).toBe(100);
    expect(rows[0]!.score! - rows[1]!.score!).toBeCloseTo(9.375, 3);
  });
});
