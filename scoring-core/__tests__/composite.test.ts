import { describe, expect, it } from 'vitest';
import { delegateScore } from '../composite.js';
import { DEFAULT_PARAMS } from '../params.js';

const W = DEFAULT_PARAMS.weights;

describe('composite', () => {
  it('is the weighted average of the pillars', () => {
    expect(delegateScore({ community: 82, holdings: 50, votes: 88 }, W)).toBeCloseTo(1276 / 16, 10);
  });

  it('stays within 0–100 because every pillar already is', () => {
    expect(delegateScore({ community: 100, holdings: 100, votes: 100 }, W)).toBe(100);
    expect(delegateScore({ community: 0, holdings: 0, votes: 0 }, W)).toBe(0);
  });

  it('excludes a missing pillar from both sides — not scored as zero', () => {
    // Graceful degradation: community unavailable → average of holdings+votes.
    const withNull = delegateScore({ community: null, holdings: 50, votes: 88 }, W)!;
    const asZero = delegateScore({ community: 0, holdings: 50, votes: 88 }, W)!;
    expect(withNull).toBeCloseTo((3 * 50 + 10 * 88) / 13, 10);
    expect(withNull).toBeGreaterThan(asZero);
  });

  it('honours a zero weight as feature-flagging a pillar off', () => {
    const off = delegateScore({ community: 0, holdings: 50, votes: 88 }, { ...W, community: 0 })!;
    expect(off).toBeCloseTo((3 * 50 + 10 * 88) / 13, 10);
  });

  it('returns null when no pillar has data', () => {
    expect(delegateScore({ community: null, holdings: null, votes: null }, W)).toBeNull();
  });

  it('returns null when every weight is zero', () => {
    expect(delegateScore({ community: 1, holdings: 2, votes: 3 }, { community: 0, holdings: 0, votes: 0 })).toBeNull();
  });

  it('weights shift the result in the expected direction', () => {
    const votesHeavy = delegateScore({ community: 0, holdings: 0, votes: 100 }, { community: 1, holdings: 1, votes: 100 })!;
    expect(votesHeavy).toBeGreaterThan(95);
  });
});
