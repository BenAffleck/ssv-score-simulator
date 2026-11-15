/**
 * Shared types for the scoring core. Pure — no I/O.
 *
 * `Params` and `Delegation` have exactly the shape of the production pipeline's
 * `config/params.json` and `config/delegation.json` (ssv-scoring), so a
 * scenario exported from the simulator drops into production config unchanged.
 */

export type Pillar = 'community' | 'holdings' | 'votes';
export const PILLARS: readonly Pillar[] = ['community', 'holdings', 'votes'];

/** Scoring parameters — production `config/params.json`. Changed by DAO vote. */
export interface Params {
  weights: { community: number; holdings: number; votes: number };
  /** `S_community = 100 · clamp(hs / ref, 0, 1)`; ref 100 is HighSignal's native scale. */
  community: { ref: number };
  /** `S_holdings = 100 · min(1, (TWAB / ref) ^ concavity)` over a `windowDays` TWAB. */
  holdings: { ref: number; concavity: number; windowDays: number };
  /** The `windowN` latest closed proposals, each weighing `0.5 ^ (age / halfLifeDays)`. */
  votes: { halfLifeDays: number; windowN: number };
}

export type CohortKey =
  | 'ssvCommunity'
  | 'verifiedOperators'
  | 'professional'
  | 'grantRecipients'
  | 'ethCommunities';
export type NominatedCohort = 'verifiedOperators' | 'professional' | 'grantRecipients';

/** Cap, threshold and cohort shares — production `config/delegation.json`. */
export interface Delegation {
  /** Ceiling on distributable power; the excess is voided. `null` = uncapped. */
  cap: number | null;
  /** An address scoring strictly above this joins SSV Community. */
  scoreThreshold: number;
  cohorts: {
    ssvCommunity: { pct: number };
    verifiedOperators: { pct: number; minMembers: number };
    professional: { pct: number; minMembers: number };
    grantRecipients: { pct: number; minMembers: number };
    ethCommunities: { pct: number };
  };
}

/** A committee's assignment of an address to a nominated cohort. */
export interface Nomination {
  address: string;
  cohort: NominatedCohort;
}

// --- Dataset ----------------------------------------------------------------

/**
 * A roster address. Production discovers these (grandfathered seed, Snapshot
 * voters and followers, HighSignal, nominations) and never removes one.
 */
export interface Candidate {
  /** Lowercase. */
  address: string;
  /** Resolved as production does: HS display name → ENS → seeded name → HS username → address. */
  displayName: string;
  /** Why the address is a candidate (`grandfathered`, `snapshot_voter`, …). Empty when unknown. */
  sources: string[];
  forumHandle: string | null;
  discordHandle: string | null;
  ensName: string | null;
}

export interface Proposal {
  id: string;
  title: string;
  /** Unix seconds the proposal closed. Flagged (moderated) proposals are never included. */
  end: number;
}

export interface Vote {
  proposalId: string;
  /** Lowercase. */
  voter: string;
  /** Unix seconds the vote was cast. */
  created: number;
}

/** A HighSignal score as observed for one address on one day. */
export interface CommunityObservation {
  address: string;
  /** YYYY-MM-DD. */
  date: string;
  score: number;
  hsUsername: string | null;
  hsRank: number | null;
}

/**
 * One address's SSV + cSSV held, as change points: each entry is the first day
 * a new total was observed, and holds until the next. Production stores a row
 * per address per collected day; since a missing day carries the previous
 * balance forward, the change points are a lossless encoding of it.
 */
export interface BalanceSeries {
  address: string;
  /** Ascending `[date, ssv + cssv]`. The first entry is the address's first collected day. */
  changes: Array<[string, number]>;
}

/** An address HighSignal publishes for one user. */
export interface IdentityLink {
  address: string;
  hsUsername: string;
}

/** What one published production run looked like — the baseline a scenario is compared to. */
export interface ProductionRun {
  runId: number;
  asOf: string;
  codeVersion: string;
  params: Params;
  delegation: Delegation;
  /** Its published rows, for checking the simulator reproduces production. */
  rows: Array<{
    address: string;
    rank: number | null;
    score: number | null;
    cohort: CohortKey | null;
    power: number;
  }>;
}

export const DATASET_VERSION = 3;

/**
 * Everything the simulator scores from, for every as-of in `dateRange`.
 *
 * Built from the production pipeline's database (`npm run import`) or from a
 * single run's `ssv-score export-dataset` file. Scores for an as-of only ever
 * read data dated on or before it, exactly as production freezes a run.
 *
 * Allocation inputs that production only records per run (pool, ETH community
 * members, opt-outs, auto-delegators) are those of `production`'s run.
 */
export interface Dataset {
  version: typeof DATASET_VERSION;
  generatedAt: string;
  /** Where it came from, shown in the header. */
  origin: string;
  space: string;
  /** The as-ofs the scrubber can reach. */
  dateRange: { start: string; end: string };
  /** In production roster order. */
  roster: Candidate[];
  proposals: Proposal[];
  votes: Vote[];
  community: CommunityObservation[];
  /** Every day production collected balances on, ascending. Coverage is dataset-wide. */
  balanceDates: string[];
  balances: BalanceSeries[];
  identities: IdentityLink[];
  nominations: Nomination[];
  ethCommunity: string[];
  optedOut: string[];
  /** Auto-delegators: delegate to the auto-delegation pool, so draw no seat. */
  safeDelegators: string[];
  /** The Safe's delegatable power per production run's as-of, ascending. */
  pools: Array<{ asOf: string; pool: number }>;
  production: ProductionRun | null;
}

// --- Results ----------------------------------------------------------------

/** One roster address, scored on its own data — production's `scores` row. */
export interface Row {
  address: string;
  displayName: string;
  /** 1-based; `null` when unscored (no live pillar with weight > 0). */
  rank: number | null;
  score: number | null;
  community: number | null;
  holdings: number | null;
  votes: number | null;
  /** True where a live pillar had no data for this address and 0 was imputed. */
  missing: { community: boolean; holdings: boolean; votes: boolean };
  twab: number | null;
  twabDays: number | null;
  communityRaw: number | null;
  votedCount: number | null;
  proposalCount: number | null;
  hsUsername: string | null;
  hsRank: number | null;
}
