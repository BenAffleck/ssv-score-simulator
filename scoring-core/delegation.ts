/**
 * Delegation impact analysis — pure, I/O-free.
 *
 * Simulates how a lump sum of delegatable SSV/cSSV ("auto-delegation") would be
 * distributed as voting power across five cohorts, and how that power lands on
 * the leaderboard. A program cap bounds the pool first: anything delegated above
 * it is voided rather than distributed, so the program's total influence has a
 * ceiling the DAO sets. This is the single place all cohort math lives, mirroring how
 * `simulate.ts`/`composite.ts` centralize scoring — the UI and any tooling share
 * exactly one implementation.
 *
 * Each leaderboard entity draws power from at most ONE cohort. An explicit pin
 * (config.assignments, any of the five cohorts) always wins; otherwise the
 * cohort is auto-derived: SSV Community (score above the threshold) takes
 * precedence over Ethereum Communities (address sourced from another HighSignal
 * community and seeded into the roster), then none.
 */
import type { EthCommunityRow, LeaderboardRow } from './types.js';

export type ManualCohort = 'verifiedOperators' | 'professional' | 'grantRecipients';
export type CohortKey = ManualCohort | 'ssvCommunity' | 'ethCommunities';

/** Cohort keys in display / allocation order. */
export const COHORT_KEYS: readonly CohortKey[] = [
  'ssvCommunity',
  'verifiedOperators',
  'professional',
  'grantRecipients',
  'ethCommunities',
];

export const COHORT_LABELS: Record<CohortKey, string> = {
  ssvCommunity: 'SSV Community',
  verifiedOperators: 'Verified Operators',
  professional: 'Professional',
  grantRecipients: 'Grant Recipients',
  ethCommunities: 'Ethereum Communities',
};

export const MANUAL_COHORTS: readonly ManualCohort[] = [
  'verifiedOperators',
  'professional',
  'grantRecipients',
];

export interface DelegationConfig {
  /** D — the SSV+cSSV lump sum delegated to/by the DAO via auto-delegation. */
  totalDelegatable: number;
  /**
   * C — the program cap: the most voting power the program may ever distribute,
   * however much is delegated to it. Anything above it is **voided**, not held:
   * it is never assigned to a cohort, and never votes. `null` = uncapped.
   *
   * This exists because D is not a number the DAO sets — it is the sum of what
   * token holders choose to auto-delegate, and it only grows. Without a ceiling,
   * a successful program eventually concentrates enough voting power in one
   * allocation rule to carry a proposal on its own.
   */
  powerCap: number | null;
  ssvCommunity: { pct: number; scoreThreshold: number };
  verifiedOperators: { pct: number; minMembers: number };
  professional: { pct: number; minMembers: number };
  grantRecipients: { pct: number; minMembers: number };
  ethCommunities: { pct: number };
  /**
   * Lowercased address → the cohort it is pinned to. Any of the five cohorts is
   * allowed — an explicit pin overrides the auto-derivation (SSV by score, ETH
   * by community membership) — and an address may be pinned to at most one.
   */
  assignments: Record<string, CohortKey>;
}

export interface CohortSummary {
  cohort: CohortKey;
  pct: number;
  /** pct/100 × totalDelegatable. */
  budget: number;
  memberCount: number;
  /** budget / memberCount, or 0 when the cohort is empty. */
  perMember: number;
  /** Configured minimum nominations, when the cohort has one. */
  minMembers?: number;
  /** Set when memberCount is below minMembers. */
  warning?: string;
}

export interface DelegationResult {
  /** Leaderboard addresses only (lowercased) → the power and cohort they draw from. */
  perEntity: Map<string, { power: number; cohort: CohortKey }>;
  cohorts: CohortSummary[];
  totalAllocated: number;
  /** D_eff − Σ budgets — a reserve when the cohort percentages sum below 100. */
  unallocated: number;
  warnings: string[];
  /** D as delegated, before the cap. */
  delegated: number;
  /** The cap in force (C), or null when uncapped. */
  cap: number | null;
  /** D_eff = min(D, C) — the pool the cohort shares are actually taken from. */
  effective: number;
  /**
   * max(0, D − C) — voting power the program permanently declines. Distinct
   * from `unallocated`, which is inside the cap and still the DAO's to assign.
   */
  voided: number;
}

function pctOf(pct: number, total: number): number {
  return (Math.max(0, pct) / 100) * Math.max(0, total);
}

/**
 * Resolve cohort membership and allocate voting power.
 *
 * @param rows       the current leaderboard (drives SSV Community eligibility)
 * @param cfg        cohort percentages, thresholds, minimums and assignments
 * @param ethMembers external published addresses for the Ethereum Communities cohort
 */
export function computeDelegation(
  rows: LeaderboardRow[],
  cfg: DelegationConfig,
  ethMembers: EthCommunityRow[],
): DelegationResult {
  const delegated = Math.max(0, cfg.totalDelegatable);

  // The cap binds before anything else: every cohort budget, and therefore
  // every delegate's power, is a share of the capped pool. Excess is voided —
  // it does not fall through to the reserve, and no cohort can ever see it.
  const cap = cfg.powerCap === null || !Number.isFinite(cfg.powerCap) ? null : Math.max(0, cfg.powerCap);
  const D = cap === null ? delegated : Math.min(delegated, cap);
  const voided = delegated - D;

  // Address → pinned cohort, but only for addresses that are actually on the
  // leaderboard (a stale assignment for a since-removed delegate is ignored).
  const onLeaderboard = new Set(rows.map((r) => r.address.toLowerCase()));
  const pinned = new Map<string, CohortKey>();
  for (const [addr, cohort] of Object.entries(cfg.assignments)) {
    const key = addr.toLowerCase();
    if (onLeaderboard.has(key)) pinned.set(key, cohort);
  }

  // Membership buckets (lists of addresses / synthetic member counts).
  const members: Record<CohortKey, string[]> = {
    ssvCommunity: [],
    verifiedOperators: [],
    professional: [],
    grantRecipients: [],
    ethCommunities: [],
  };

  // Addresses sourced from other HighSignal communities (seeded into the roster).
  const ethSet = new Set<string>();
  for (const m of ethMembers) if (m.address) ethSet.add(m.address.toLowerCase());

  for (const r of rows) {
    const key = r.address.toLowerCase();
    const pin = pinned.get(key);
    if (pin) {
      members[pin].push(key);
      continue; // an explicit pin overrides auto-derivation
    }
    // Auto: SSV Community (score above the threshold) takes precedence over
    // Ethereum Communities, even when a delegate belongs to both.
    if (r.score !== null && r.score > cfg.ssvCommunity.scoreThreshold) {
      members.ssvCommunity.push(key);
      continue;
    }
    if (ethSet.has(key)) {
      members.ethCommunities.push(key);
    }
  }

  const min: Partial<Record<CohortKey, number>> = {
    verifiedOperators: cfg.verifiedOperators.minMembers,
    professional: cfg.professional.minMembers,
    grantRecipients: cfg.grantRecipients.minMembers,
  };
  const pct: Record<CohortKey, number> = {
    ssvCommunity: cfg.ssvCommunity.pct,
    verifiedOperators: cfg.verifiedOperators.pct,
    professional: cfg.professional.pct,
    grantRecipients: cfg.grantRecipients.pct,
    ethCommunities: cfg.ethCommunities.pct,
  };

  const cohorts: CohortSummary[] = [];
  const perEntity = new Map<string, { power: number; cohort: CohortKey }>();
  const warnings: string[] = [];
  let totalAllocated = 0;

  // Surfaced, never silent: a binding cap changes every delegate's power, and
  // an operator reading the leaderboard must be able to see why.
  if (voided > 0) {
    warnings.push(
      `Program cap of ${cap} reached: ${round(voided)} of ${round(delegated)} delegated is voided.`,
    );
  }

  for (const cohort of COHORT_KEYS) {
    const list = members[cohort];
    const budget = pctOf(pct[cohort], D);
    const perMember = list.length > 0 ? budget / list.length : 0;
    const minMembers = min[cohort];

    let warning: string | undefined;
    if (minMembers !== undefined && list.length < minMembers) {
      warning = `${COHORT_LABELS[cohort]} has ${list.length} of ${minMembers} required nominations.`;
      warnings.push(warning);
    }

    for (const key of list) perEntity.set(key, { power: perMember, cohort });
    if (list.length > 0) totalAllocated += budget;

    cohorts.push({ cohort, pct: pct[cohort], budget, memberCount: list.length, perMember, minMembers, warning });
  }

  return {
    perEntity,
    cohorts,
    totalAllocated,
    unallocated: Math.max(0, D - totalAllocated),
    warnings,
    delegated,
    cap,
    effective: D,
    voided,
  };
}

const round = (x: number): number => Math.round(x * 100) / 100;
