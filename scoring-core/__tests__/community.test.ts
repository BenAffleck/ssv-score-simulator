import { describe, expect, it } from 'vitest';
import { normalizeCommunity } from '../community.js';

describe('community normalization', () => {
  it('native passes a 0–100 HighSignal score straight through', () => {
    expect(normalizeCommunity(82, { mode: 'native', refValue: 100 })).toBe(82);
  });

  it('native clamps out-of-range input', () => {
    expect(normalizeCommunity(140, { mode: 'native', refValue: 100 })).toBe(100);
    expect(normalizeCommunity(-3, { mode: 'native', refValue: 100 })).toBe(0);
  });

  it('refcap rescales against a reference and caps at 100', () => {
    expect(normalizeCommunity(30, { mode: 'refcap', refValue: 60 })).toBe(50);
    expect(normalizeCommunity(90, { mode: 'refcap', refValue: 60 })).toBe(100);
  });

  it('minmax stretches the roster onto the full range', () => {
    const opts = { mode: 'minmax' as const, refValue: 100 };
    const ctx = { min: 20, max: 80 };
    expect(normalizeCommunity(20, opts, ctx)).toBe(0);
    expect(normalizeCommunity(50, opts, ctx)).toBe(50);
    expect(normalizeCommunity(80, opts, ctx)).toBe(100);
  });

  it('minmax on a uniform roster gives everyone full marks rather than inventing spread', () => {
    expect(normalizeCommunity(42, { mode: 'minmax', refValue: 100 }, { min: 42, max: 42 })).toBe(100);
    expect(normalizeCommunity(0, { mode: 'minmax', refValue: 100 }, { min: 0, max: 0 })).toBe(0);
  });

  it('treats non-finite input as 0', () => {
    expect(normalizeCommunity(NaN, { mode: 'native', refValue: 100 })).toBe(0);
  });
});
