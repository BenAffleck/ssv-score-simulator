/**
 * Ratified defaults and preset (de)serialisation. Presets are written in the
 * production config format, so an exported scenario is a drop-in
 * `config/params.json`, `config/delegation.json` or `config/nominations.csv`.
 */
import { COHORT_KEYS, NOMINATED_COHORTS } from './allocation.js';
import type { Delegation, Nomination, NominatedCohort, Params } from './types.js';

/** Production `config/params.json`. */
export const DEFAULT_PARAMS: Params = {
  weights: { community: 3, holdings: 3, votes: 10 },
  community: { ref: 100 },
  holdings: { ref: 10_000, concavity: 0.5, windowDays: 90 },
  votes: { halfLifeDays: 90, windowN: 10 },
};

/** Production `config/delegation.json`. The DAO lowered the cap from the proposed 750,000. */
export const DEFAULT_DELEGATION: Delegation = {
  cap: 500_000,
  scoreThreshold: 20,
  cohorts: {
    ssvCommunity: { pct: 45 },
    verifiedOperators: { pct: 25, minMembers: 5 },
    professional: { pct: 10, minMembers: 1 },
    grantRecipients: { pct: 15, minMembers: 5 },
    ethCommunities: { pct: 5 },
  },
};

export class PresetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresetError';
  }
}

export function cloneParams(p: Params): Params {
  return {
    weights: { ...p.weights },
    community: { ...p.community },
    holdings: { ...p.holdings },
    votes: { ...p.votes },
  };
}

export function cloneDelegation(d: Delegation): Delegation {
  return {
    cap: d.cap,
    scoreThreshold: d.scoreThreshold,
    cohorts: {
      ssvCommunity: { ...d.cohorts.ssvCommunity },
      verifiedOperators: { ...d.cohorts.verifiedOperators },
      professional: { ...d.cohorts.professional },
      grantRecipients: { ...d.cohorts.grantRecipients },
      ethCommunities: { ...d.cohorts.ethCommunities },
    },
  };
}

export function paramsEqual(a: Params, b: Params): boolean {
  return JSON.stringify(cloneParams(a)) === JSON.stringify(cloneParams(b));
}

export function delegationEqual(a: Delegation, b: Delegation): boolean {
  return JSON.stringify(cloneDelegation(a)) === JSON.stringify(cloneDelegation(b));
}

/**
 * Parse `config/params.json` (or a simulator preset wrapping one under
 * `params`). Validated as production validates it: unknown keys and
 * out-of-range values are errors, never silently defaulted, because a preset
 * that loads differently than production would read it is a wrong scenario.
 */
export function parseParams(input: unknown): Params {
  const root = record(input, 'params');
  const raw = 'params' in root ? record(root.params, 'params') : root;
  keys(raw, ['weights', 'community', 'holdings', 'votes'], 'params');
  const w = record(raw.weights, 'weights');
  keys(w, ['community', 'holdings', 'votes'], 'weights');
  const c = record(raw.community, 'community');
  keys(c, ['ref'], 'community');
  const h = record(raw.holdings, 'holdings');
  keys(h, ['ref', 'concavity', 'windowDays'], 'holdings');
  const v = record(raw.votes, 'votes');
  keys(v, ['halfLifeDays', 'windowN'], 'votes');
  return {
    weights: {
      community: num(w.community, 'weights.community', { min: 0 }),
      holdings: num(w.holdings, 'weights.holdings', { min: 0 }),
      votes: num(w.votes, 'weights.votes', { min: 0 }),
    },
    community: { ref: num(c.ref, 'community.ref', { above: 0 }) },
    holdings: {
      ref: num(h.ref, 'holdings.ref', { above: 0 }),
      concavity: num(h.concavity, 'holdings.concavity', { above: 0 }),
      windowDays: num(h.windowDays, 'holdings.windowDays', { min: 1, integer: true }),
    },
    votes: {
      halfLifeDays: num(v.halfLifeDays, 'votes.halfLifeDays', { above: 0 }),
      windowN: num(v.windowN, 'votes.windowN', { min: 1, integer: true }),
    },
  };
}

/** Parse `config/delegation.json` (or a preset wrapping one under `delegation`). */
export function parseDelegation(input: unknown): Delegation {
  const root = record(input, 'delegation');
  const raw = 'delegation' in root ? record(root.delegation, 'delegation') : root;
  // Runs from before the pool was read from the Safe froze it here.
  keys(raw, ['cap', 'scoreThreshold', 'cohorts', 'pool'], 'delegation');
  const cohorts = record(raw.cohorts, 'cohorts');
  keys(cohorts, [...COHORT_KEYS], 'cohorts');
  const automatic = (key: 'ssvCommunity' | 'ethCommunities') => {
    const r = record(cohorts[key], `cohorts.${key}`);
    keys(r, ['pct'], `cohorts.${key}`);
    return { pct: num(r.pct, `cohorts.${key}.pct`, { min: 0 }) };
  };
  const nominated = (key: NominatedCohort) => {
    const r = record(cohorts[key], `cohorts.${key}`);
    keys(r, ['pct', 'minMembers'], `cohorts.${key}`);
    return {
      pct: num(r.pct, `cohorts.${key}.pct`, { min: 0 }),
      minMembers: num(r.minMembers, `cohorts.${key}.minMembers`, { min: 0, integer: true }),
    };
  };
  return {
    cap: raw.cap === null ? null : num(raw.cap, 'cap', { min: 0 }),
    scoreThreshold: num(raw.scoreThreshold, 'scoreThreshold', {}),
    cohorts: {
      ssvCommunity: automatic('ssvCommunity'),
      verifiedOperators: nominated('verifiedOperators'),
      professional: nominated('professional'),
      grantRecipients: nominated('grantRecipients'),
      ethCommunities: automatic('ethCommunities'),
    },
  };
}

/** Parse production `nominations.csv` (`address,cohort,committee,note`) or a JSON list. */
export function parseNominations(input: unknown): Nomination[] {
  if (typeof input === 'string') return parseNominationsCsv(input);
  const list = Array.isArray(input) ? input : record(input, 'nominations').nominations;
  if (!Array.isArray(list)) throw new PresetError('nominations: expected a list.');
  return dedupe(
    list.map((n, i) => {
      const r = record(n, `nominations[${i}]`);
      return nomination(r.address, r.cohort, `nominations[${i}]`);
    }),
  );
}

function parseNominationsCsv(text: string): Nomination[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = (lines.shift() ?? '').split(',').map((h) => h.trim());
  const ai = header.indexOf('address');
  const ci = header.indexOf('cohort');
  if (ai < 0 || ci < 0) throw new PresetError('nominations.csv: needs address and cohort columns.');
  return dedupe(
    lines.map((line, i) => {
      const cells = line.split(',').map((c) => c.trim());
      return nomination(cells[ai], cells[ci], `nominations.csv line ${i + 2}`);
    }),
  );
}

function nomination(address: unknown, cohort: unknown, field: string): Nomination {
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new PresetError(`${field}.address: not a 20-byte hex address.`);
  }
  if (!(NOMINATED_COHORTS as readonly unknown[]).includes(cohort)) {
    throw new PresetError(`${field}.cohort: must be one of ${NOMINATED_COHORTS.join(', ')}.`);
  }
  return { address: address.toLowerCase(), cohort: cohort as NominatedCohort };
}

function dedupe(nominations: Nomination[]): Nomination[] {
  const seen = new Set<string>();
  for (const n of nominations) {
    if (seen.has(n.address)) throw new PresetError(`nominations: ${n.address} appears twice.`);
    seen.add(n.address);
  }
  return nominations;
}

/** `config/nominations.csv` text. Committee and note are production bookkeeping. */
export function nominationsCsv(nominations: readonly Nomination[]): string {
  return [
    'address,cohort,committee,note',
    ...nominations.map((n) => `${n.address},${n.cohort},Simulator,Scenario`),
  ].join('\n');
}

function record(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new PresetError(`${field}: expected an object.`);
  }
  return v as Record<string, unknown>;
}

function keys(r: Record<string, unknown>, allowed: string[], field: string): void {
  for (const k of Object.keys(r)) {
    if (!allowed.includes(k)) throw new PresetError(`${field}.${k}: unknown key.`);
  }
}

function num(
  v: unknown,
  field: string,
  rule: { min?: number; above?: number; integer?: boolean },
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new PresetError(`${field}: expected a number.`);
  if (rule.integer && !Number.isInteger(v)) throw new PresetError(`${field}: expected an integer.`);
  if (rule.min !== undefined && v < rule.min) throw new PresetError(`${field}: must be ≥ ${rule.min}.`);
  if (rule.above !== undefined && v <= rule.above) {
    throw new PresetError(`${field}: must be > ${rule.above}.`);
  }
  return v;
}
