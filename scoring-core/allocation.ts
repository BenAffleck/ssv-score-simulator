/**
 * Cohort allocation, a port of production's `scoring/allocation.py`.
 *
 * The pool is capped before it is split into cohort budgets. Each identity
 * draws at most one seat, held by one of its addresses; each cohort's budget is
 * split equally across its seats.
 */
import { cmp } from './prepared.js';
import { pySum } from './pysum.js';
import type { CohortKey, Delegation, Nomination } from './types.js';

/** Production's cohort order. */
export const COHORT_KEYS: readonly CohortKey[] = [
  'ssvCommunity',
  'verifiedOperators',
  'professional',
  'grantRecipients',
  'ethCommunities',
];

export const NOMINATED_COHORTS = ['verifiedOperators', 'professional', 'grantRecipients'] as const;

export const COHORT_LABELS: Record<CohortKey, string> = {
  ssvCommunity: 'SSV Community',
  verifiedOperators: 'Verified Operators',
  professional: 'Professional',
  grantRecipients: 'Grant Recipients',
  ethCommunities: 'Ethereum Communities',
};

/** One identity nominated to two cohorts. Production aborts the run on this. */
export class NominationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NominationConflictError';
  }
}

export interface CohortAllocation {
  cohort: CohortKey;
  pct: number;
  budget: number;
  /** Seats, i.e. identities. */
  memberCount: number;
  perMember: number;
  minMembers: number | null;
  warning: string | null;
}

export interface Allocation {
  /** The pool before the cap. */
  delegated: number;
  cap: number | null;
  /** `min(pool, cap)` — what the cohort shares are taken from. */
  effective: number;
  /** Power above the cap, permanently declined. */
  voided: number;
  /** Effective power left when cohort shares sum below 100%. */
  unallocated: number;
  warnings: string[];
  /** Seat-holding address → its cohort. */
  members: Map<string, CohortKey>;
  /** Every scored address → its power (0 without a seat). */
  power: Map<string, number>;
  cohorts: CohortAllocation[];
  /** Nominations void because their address opted out. */
  overridden: Nomination[];
}

export interface AllocationInputs {
  /** Address → score, in ranked order. */
  scores: Map<string, number | null>;
  pool: number;
  delegation: Delegation;
  nominations?: readonly Nomination[];
  /** Address → identity id; an address without one is an identity of one. */
  identities?: Map<string, string>;
  ethCommunity?: ReadonlySet<string>;
  optedOut?: ReadonlySet<string>;
  safeDelegators?: ReadonlySet<string>;
}

/**
 * Give each identity at most one cohort seat and split each budget equally.
 *
 * An identity with a nominated address joins its nominated cohort. Any other
 * identity with an address scoring above the threshold joins SSV Community,
 * then one with an address in `ethCommunity` joins Ethereum Communities; the
 * rest join none. The seat is held by the identity's highest-scoring address
 * that qualified, the lower address on a tie. An opted-out address or an
 * auto-delegator qualifies for no cohort. Throws NominationConflictError when
 * one identity is nominated to two cohorts by addresses that are not excluded.
 */
export function allocate({
  scores,
  pool,
  delegation,
  nominations = [],
  identities = new Map(),
  ethCommunity = new Set(),
  optedOut = new Set(),
  safeDelegators = new Set(),
}: AllocationInputs): Allocation {
  const excluded = (a: string) => optedOut.has(a) || safeDelegators.has(a);
  const identityOf = (a: string) => identities.get(a) ?? a;
  const overridden = nominations.filter((n) => optedOut.has(n.address));
  const nominated = nominatedCohorts(
    nominations.filter((n) => !excluded(n.address)),
    identityOf,
  );

  const groups = new Map<string, string[]>();
  for (const address of scores.keys()) {
    const id = identityOf(address);
    const group = groups.get(id);
    if (group) group.push(address);
    else groups.set(id, [address]);
  }

  const seats = new Map<string, [CohortKey, string]>();
  for (const [identity, group] of groups) {
    const addresses = group.filter((a) => !excluded(a));
    const qualifying = addresses.filter((a) => nominated.has(a));
    if (qualifying.length > 0) {
      seats.set(identity, [nominated.get(qualifying[0]!)!, holder(qualifying, scores)]);
      continue;
    }
    const above = addresses.filter((a) => isAbove(scores.get(a) ?? null, delegation.scoreThreshold));
    const inEth = addresses.filter((a) => ethCommunity.has(a));
    if (above.length > 0) seats.set(identity, ['ssvCommunity', holder(above, scores)]);
    else if (inEth.length > 0) seats.set(identity, ['ethCommunities', holder(inEth, scores)]);
  }

  const cap = delegation.cap;
  const effective = cap === null ? pool : Math.min(pool, cap);
  const voided = pool - effective;
  const warnings = nominations
    .filter((n) => safeDelegators.has(n.address) && !optedOut.has(n.address))
    .map(
      (n) =>
        `${n.address} delegates to the auto-delegation pool, so its ${n.cohort} nomination is void.`,
    );
  if ([...groups.values()].every((addresses) => addresses.length === 1)) {
    warnings.push('no identity has several addresses: cohort seats are allocated per address');
  }
  if (voided > 0) warnings.push(`cap binds: ${fmt(voided)} of the ${fmt(pool)} pool is voided`);
  const shares = pySum(COHORT_KEYS.map((c) => delegation.cohorts[c].pct));
  if (shares > 100) warnings.push(`cohort shares sum to ${fmt(shares)}%, above 100%`);

  const cohorts: CohortAllocation[] = [];
  for (const cohort of COHORT_KEYS) {
    const share = delegation.cohorts[cohort];
    const budget = (share.pct / 100) * effective;
    let count = 0;
    for (const [c] of seats.values()) if (c === cohort) count++;
    const minimum = 'minMembers' in share ? share.minMembers : null;
    const warning =
      minimum !== null && count < minimum ? `${cohort} has ${count} of at least ${minimum} members` : null;
    if (warning) warnings.push(warning);
    cohorts.push({
      cohort,
      pct: share.pct,
      budget,
      memberCount: count,
      perMember: count ? budget / count : 0,
      minMembers: minimum,
      warning,
    });
  }

  const perMember = new Map(cohorts.map((c) => [c.cohort, c.perMember]));
  const members = new Map<string, CohortKey>();
  const power = new Map<string, number>();
  for (const address of scores.keys()) power.set(address, 0);
  for (const [cohort, address] of seats.values()) {
    members.set(address, cohort);
    power.set(address, perMember.get(cohort)!);
  }
  return {
    delegated: pool,
    cap,
    effective,
    voided,
    unallocated: Math.max(0, ((100 - shares) / 100) * effective),
    warnings,
    members,
    power,
    cohorts,
    overridden,
  };
}

/** The highest-scoring of `addresses`, the lower address on a tie. Unscored ranks last. */
function holder(addresses: string[], scores: Map<string, number | null>): string {
  const key = (a: string): [number, number] => {
    const s = scores.get(a) ?? null;
    return [s === null ? 1 : 0, -(s ?? 0)];
  };
  return addresses.reduce((best, a) => {
    const [x0, x1] = key(a);
    const [y0, y1] = key(best);
    return x0 < y0 || (x0 === y0 && (x1 < y1 || (x1 === y1 && cmp(a, best) < 0))) ? a : best;
  });
}

function isAbove(score: number | null, threshold: number): boolean {
  return score !== null && score > threshold;
}

/** Each nominated address mapped to its identity's cohort. Throws on a conflicting identity. */
function nominatedCohorts(
  nominations: readonly Nomination[],
  identityOf: (address: string) => string,
): Map<string, CohortKey> {
  const cohorts = new Map<string, CohortKey>();
  const nominees = new Map<string, string>();
  for (const n of nominations) {
    const identity = identityOf(n.address);
    if (!nominees.has(identity)) nominees.set(identity, n.address);
    if (!cohorts.has(identity)) cohorts.set(identity, n.cohort);
    if (cohorts.get(identity) !== n.cohort) {
      throw new NominationConflictError(
        `${nominees.get(identity)} and ${n.address} are one identity nominated to` +
          ` ${cohorts.get(identity)} and ${n.cohort}`,
      );
    }
  }
  return new Map(nominations.map((n) => [n.address, cohorts.get(identityOf(n.address))!]));
}

/** Python's `:g` format, for warning text parity. */
function fmt(x: number): string {
  if (x === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(x)));
  if (exp < -4 || exp >= 6) {
    const [m, e] = x.toExponential(5).split('e');
    return `${trimZeros(m!)}e${e!.startsWith('-') ? '-' : '+'}${e!.replace(/^[+-]/, '').padStart(2, '0')}`;
  }
  return trimZeros(x.toFixed(Math.max(0, 5 - exp)));
}

const trimZeros = (s: string): string => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
