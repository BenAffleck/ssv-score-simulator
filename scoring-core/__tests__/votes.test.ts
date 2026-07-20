import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, dateToTs } from '../dates.js';
import { DEFAULT_PARAMS } from '../params.js';
import type { ProposalRow } from '../types.js';
import { recencyWeight, votesScore } from '../votes.js';
import { AS_OF, PROPOSALS, VOTED_LATEST_4, VOTED_OLDEST_4 } from './fixtures.js';

const V = DEFAULT_PARAMS.votes;
const all = new Set(PROPOSALS.map((p) => p.id));

describe('recency weight', () => {
  it('is 1 at age 0 and halves every half-life', () => {
    expect(recencyWeight(0, 90)).toBe(1);
    expect(recencyWeight(90, 90)).toBeCloseTo(0.5, 10);
    expect(recencyWeight(180, 90)).toBeCloseTo(0.25, 10);
  });
});

describe('participation score', () => {
  it('voting on everything scores 100', () => {
    expect(votesScore(PROPOSALS, all, AS_OF, V).score).toBeCloseTo(100, 10);
  });

  it('voting on nothing scores 0', () => {
    expect(votesScore(PROPOSALS, new Set(), AS_OF, V).score).toBe(0);
  });

  it('reports the underlying counts', () => {
    const r = votesScore(PROPOSALS, VOTED_LATEST_4, AS_OF, V);
    expect(r.votedCount).toBe(4);
    expect(r.proposalCount).toBe(5);
  });

  it('returns null when no proposal has closed yet as of the date', () => {
    const r = votesScore(PROPOSALS, all, '2020-01-01', V);
    expect(r.score).toBeNull();
    expect(r.proposalCount).toBe(0);
  });
});

describe('half-life lever (acceptance §5)', () => {
  it('raising H flattens recency — 4-of-5 converges toward the flat 80', () => {
    const at = (halfLifeDays: number) =>
      votesScore(PROPOSALS, VOTED_OLDEST_4, AS_OF, { ...V, halfLifeDays }).score!;

    // Missing the newest is punished hard at short half-lives, mildly at long ones.
    expect(at(30)).toBeLessThan(at(90));
    expect(at(90)).toBeLessThan(at(3_650));
    expect(at(3_650)).toBeCloseTo(80, 0); // effectively flat counting
  });

  it('a very short half-life makes only the newest proposal matter', () => {
    const newestOnly = votesScore(PROPOSALS, new Set(['p0']), AS_OF, { ...V, halfLifeDays: 1 });
    expect(newestOnly.score!).toBeGreaterThan(99);
  });
});

describe('proposal window N', () => {
  const older: ProposalRow[] = Array.from({ length: 10 }, (_, i) => ({
    id: `q${i}`,
    title: `Q${i}`,
    endTs: dateToTs(AS_OF) - i * 10 * DAY_SECONDS,
  }));

  it('only the N most recent closed proposals count', () => {
    // Voted on the 3 newest only.
    const voted = new Set(['q0', 'q1', 'q2']);
    expect(votesScore(older, voted, AS_OF, { ...V, windowN: 3 }).score).toBeCloseTo(100, 10);
    expect(votesScore(older, voted, AS_OF, { ...V, windowN: 10 }).score!).toBeLessThan(100);
  });

  it('caps the window at the number of available proposals', () => {
    expect(votesScore(PROPOSALS, all, AS_OF, { ...V, windowN: 50 }).proposalCount).toBe(5);
  });
});

describe('as-of honesty', () => {
  it('never counts a proposal that closed after the as-of date', () => {
    // 60 days earlier only p2, p3, p4 had closed; Alice voted p2 and p3.
    const earlier = '2026-05-01';
    const r = votesScore(PROPOSALS, VOTED_LATEST_4, earlier, V);
    expect(r.proposalCount).toBe(3);
    expect(r.votedCount).toBe(2);
  });
});
