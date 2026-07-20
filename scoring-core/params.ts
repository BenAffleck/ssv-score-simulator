/**
 * Default parameters (the proposal's ratified values) and preset
 * serialisation. Pure — imported by both the UI and the collector.
 */
import type { CommunityMode, HoldingsMode, ScoringParams } from './types.js';

/** The proposal defaults: w={3,3,10}, HOLD_REF=10000, p=0.5, T=180, H=90, N=5. */
export const DEFAULT_PARAMS: ScoringParams = {
  weights: { community: 3, holdings: 3, votes: 10 },
  holdings: { ref: 10_000, concavity: 0.5, mode: 'power', windowDays: 180 },
  votes: { halfLifeDays: 90, windowN: 5 },
  community: { mode: 'native', refValue: 100 },
  // A delegate with no data for a live pillar scores 0 there, so missing data
  // can never outrank a measured value.
  missingPolicy: 'zero',
};

export const PRESET_VERSION = 1;

export interface Preset {
  version: number;
  name: string;
  exportedAt: string;
  params: ScoringParams;
}

export function clonePolicy(p: ScoringParams): ScoringParams {
  return {
    weights: { ...p.weights },
    holdings: { ...p.holdings },
    votes: { ...p.votes },
    community: { ...p.community },
    missingPolicy: p.missingPolicy,
  };
}

export function exportPreset(params: ScoringParams, name = 'custom'): Preset {
  return {
    version: PRESET_VERSION,
    name,
    exportedAt: new Date().toISOString(),
    params: clonePolicy(params),
  };
}

/**
 * Parse a preset back into params. Strict enough that a round-trip is exact
 * (acceptance §4) but tolerant of missing keys, which fall back to defaults.
 */
export function parsePreset(input: unknown): ScoringParams {
  const root = asRecord(input);
  const raw = asRecord(root.params ?? root); // accept a bare params object too
  const w = asRecord(raw.weights);
  const h = asRecord(raw.holdings);
  const v = asRecord(raw.votes);
  const c = asRecord(raw.community);

  const d = DEFAULT_PARAMS;
  return {
    weights: {
      community: num(w.community, d.weights.community, 0),
      holdings: num(w.holdings, d.weights.holdings, 0),
      votes: num(w.votes, d.weights.votes, 0),
    },
    holdings: {
      ref: num(h.ref, d.holdings.ref, 1e-9),
      concavity: num(h.concavity, d.holdings.concavity, 0.01),
      mode: (h.mode === 'log' ? 'log' : 'power') as HoldingsMode,
      windowDays: num(h.windowDays, d.holdings.windowDays, 1),
    },
    votes: {
      halfLifeDays: num(v.halfLifeDays, d.votes.halfLifeDays, 0.01),
      windowN: num(v.windowN, d.votes.windowN, 1),
    },
    community: {
      mode: (['native', 'minmax', 'refcap'].includes(String(c.mode))
        ? c.mode
        : d.community.mode) as CommunityMode,
      refValue: num(c.refValue, d.community.refValue, 1e-9),
    },
    missingPolicy: raw.missingPolicy === 'exclude' ? 'exclude' : d.missingPolicy,
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function num(v: unknown, fallback: number, min: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}
