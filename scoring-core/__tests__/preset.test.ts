/** Acceptance §4 — exported preset JSON round-trips to identical scores. */
import { describe, expect, it } from 'vitest';
import {
  DELEGATION_PRESET_VERSION,
  DEFAULT_DELEGATION,
  DEFAULT_PARAMS,
  exportDelegationPreset,
  exportPreset,
  parseDelegation,
  parseDelegationPreset,
  parsePreset,
} from '../params.js';
import type { DelegationConfig } from '../delegation.js';
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

describe('delegation preset — separate from the scoring preset', () => {
  const DELEGATION: DelegationConfig = {
    totalDelegatable: 250_000,
    ssvCommunity: { pct: 35, scoreThreshold: 30 },
    verifiedOperators: { pct: 15, minMembers: 7 },
    professional: { pct: 20, minMembers: 2 },
    grantRecipients: { pct: 20, minMembers: 6 },
    ethCommunities: { pct: 10 },
    assignments: { '0xaaa': 'verifiedOperators', '0xbbb': 'grantRecipients' },
  };

  it('the scoring preset never carries delegation (they are not mixed)', () => {
    expect(Object.keys(exportPreset(DEFAULT_PARAMS, 'x'))).not.toContain('delegation');
  });

  it('stamps its own version and round-trips the config exactly', () => {
    const preset = exportDelegationPreset(DELEGATION, 'x');
    expect(preset.version).toBe(DELEGATION_PRESET_VERSION);
    const json = JSON.stringify(preset);
    expect(parseDelegationPreset(JSON.parse(json))).toEqual(DELEGATION);
  });

  it('accepts a bare delegation config as well as a wrapped preset', () => {
    expect(parseDelegationPreset(JSON.parse(JSON.stringify(DELEGATION)))).toEqual(DELEGATION);
  });

  it('falls back to defaults for missing or malformed input', () => {
    expect(parseDelegationPreset({})).toEqual(DEFAULT_DELEGATION);
    expect(parseDelegationPreset(null)).toEqual(DEFAULT_DELEGATION);
  });

  it('keeps any of the five cohorts and drops unknown strings from assignments', () => {
    const parsed = parseDelegation({
      assignments: { '0xAAA': 'ethCommunities', '0xbbb': 'professional', '0xccc': 'bogusCohort' },
    });
    expect(parsed.assignments).toEqual({ '0xaaa': 'ethCommunities', '0xbbb': 'professional' });
  });
});
