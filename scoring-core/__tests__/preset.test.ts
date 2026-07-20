/** Acceptance §4 — exported preset JSON round-trips to identical scores. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, exportPreset, parsePreset } from '../params.js';
import { indexDataset, simulate } from '../simulate.js';
import type { ScoringParams } from '../types.js';
import { AS_OF, workedExampleDataset } from './fixtures.js';

const index = indexDataset(workedExampleDataset());

const TWEAKED: ScoringParams = {
  weights: { community: 7, holdings: 1.5, votes: 4 },
  holdings: { ref: 25_000, concavity: 0.72, mode: 'log', windowDays: 90 },
  votes: { halfLifeDays: 45, windowN: 3 },
  community: { mode: 'refcap', refValue: 90 },
  missingPolicy: 'exclude',
};

describe('preset round-trip', () => {
  for (const [name, params] of [
    ['proposal defaults', DEFAULT_PARAMS],
    ['tweaked params', TWEAKED],
  ] as const) {
    it(`${name}: JSON round-trip reproduces the params exactly`, () => {
      const json = JSON.stringify(exportPreset(params, name));
      expect(parsePreset(JSON.parse(json))).toEqual(params);
    });

    it(`${name}: JSON round-trip reproduces identical scores`, () => {
      const json = JSON.stringify(exportPreset(params, name));
      const before = simulate(index, params, AS_OF);
      const after = simulate(index, parsePreset(JSON.parse(json)), AS_OF);
      expect(after).toEqual(before);
    });
  }

  it('accepts a bare params object as well as a wrapped preset', () => {
    expect(parsePreset(JSON.parse(JSON.stringify(TWEAKED)))).toEqual(TWEAKED);
  });

  it('falls back to defaults for missing or malformed fields', () => {
    expect(parsePreset({})).toEqual(DEFAULT_PARAMS);
    expect(parsePreset(null)).toEqual(DEFAULT_PARAMS);
    expect(parsePreset({ params: { weights: { votes: 'nonsense' } } }).weights.votes).toBe(10);
  });

  it('rejects an unknown community mode rather than propagating it', () => {
    expect(parsePreset({ params: { community: { mode: 'bogus' } } }).community.mode).toBe('native');
  });

  it('different params really do produce different scores (the test above is not vacuous)', () => {
    const a = simulate(index, DEFAULT_PARAMS, AS_OF);
    const b = simulate(index, TWEAKED, AS_OF);
    expect(b).not.toEqual(a);
  });
});
