/**
 * Default parameters (the proposal's ratified values) and preset
 * serialisation. Pure — imported by both the UI and the collector.
 */
import { COHORT_KEYS, type CohortKey, type DelegationConfig } from './delegation.js';
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

/** Cohort split ratified with the DAO: 30/20/20/20/10, sums to 100%. */
export const DEFAULT_DELEGATION: DelegationConfig = {
  totalDelegatable: 200_000,
  ssvCommunity: { pct: 30, scoreThreshold: 25 },
  verifiedOperators: { pct: 20, minMembers: 5 },
  professional: { pct: 20, minMembers: 1 },
  grantRecipients: { pct: 20, minMembers: 5 },
  ethCommunities: { pct: 10 },
  assignments: {},
};

export const PRESET_VERSION = 1;

export interface Preset {
  version: number;
  name: string;
  exportedAt: string;
  params: ScoringParams;
}

/** Delegation impact analysis exports separately — never mixed with a scoring preset. */
export const DELEGATION_PRESET_VERSION = 1;

export interface DelegationPreset {
  version: number;
  name: string;
  exportedAt: string;
  delegation: DelegationConfig;
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

export function cloneDelegation(d: DelegationConfig): DelegationConfig {
  return {
    totalDelegatable: d.totalDelegatable,
    ssvCommunity: { ...d.ssvCommunity },
    verifiedOperators: { ...d.verifiedOperators },
    professional: { ...d.professional },
    grantRecipients: { ...d.grantRecipients },
    ethCommunities: { ...d.ethCommunities },
    assignments: { ...d.assignments },
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

export function exportDelegationPreset(delegation: DelegationConfig, name = 'custom'): DelegationPreset {
  return {
    version: DELEGATION_PRESET_VERSION,
    name,
    exportedAt: new Date().toISOString(),
    delegation: cloneDelegation(delegation),
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

/**
 * Parse a delegation config back into a full object. Tolerant like
 * `parsePreset`: missing keys fall back to DEFAULT_DELEGATION, numbers are
 * clamped to sane minimums, and only recognised cohort strings survive in
 * `assignments`. A v1 preset (no `delegation`) simply yields the defaults.
 */
export function parseDelegation(input: unknown): DelegationConfig {
  const raw = asRecord(input);
  const d = DEFAULT_DELEGATION;
  const ssv = asRecord(raw.ssvCommunity);
  const vops = asRecord(raw.verifiedOperators);
  const prof = asRecord(raw.professional);
  const grant = asRecord(raw.grantRecipients);
  const eth = asRecord(raw.ethCommunities);

  const assignments: Record<string, CohortKey> = {};
  const rawAssign = asRecord(raw.assignments);
  const allowed = new Set<string>(COHORT_KEYS);
  for (const [addr, cohort] of Object.entries(rawAssign)) {
    if (typeof cohort === 'string' && allowed.has(cohort)) {
      assignments[addr.toLowerCase()] = cohort as CohortKey;
    }
  }

  return {
    totalDelegatable: num(raw.totalDelegatable, d.totalDelegatable, 0),
    ssvCommunity: {
      pct: num(ssv.pct, d.ssvCommunity.pct, 0),
      scoreThreshold: num(ssv.scoreThreshold, d.ssvCommunity.scoreThreshold, 0),
    },
    verifiedOperators: {
      pct: num(vops.pct, d.verifiedOperators.pct, 0),
      minMembers: num(vops.minMembers, d.verifiedOperators.minMembers, 0),
    },
    professional: {
      pct: num(prof.pct, d.professional.pct, 0),
      minMembers: num(prof.minMembers, d.professional.minMembers, 0),
    },
    grantRecipients: {
      pct: num(grant.pct, d.grantRecipients.pct, 0),
      minMembers: num(grant.minMembers, d.grantRecipients.minMembers, 0),
    },
    ethCommunities: { pct: num(eth.pct, d.ethCommunities.pct, 0) },
    assignments,
  };
}

/**
 * Parse a delegation preset (or a bare delegation config) back into a config.
 * Mirrors `parsePreset` for scoring: tolerant, round-trip-exact.
 */
export function parseDelegationPreset(input: unknown): DelegationConfig {
  const root = asRecord(input);
  return parseDelegation(root.delegation ?? root);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function num(v: unknown, fallback: number, min: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}
