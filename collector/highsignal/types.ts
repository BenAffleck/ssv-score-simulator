import type { EthCommunityRow, HighSignalRow, IdentityRow } from '../../scoring-core/types.js';

/** One daily observation from a user's `historicalScores` series. */
export interface HighSignalHistoricalScore {
  /** YYYY-MM-DD */
  day: string;
  /** Same 0–100 scale as `score`; the newest entry equals `score`. */
  totalScore: number;
}

/**
 * One user record from `GET /api/users`.
 *
 * Field names verified against the live API — note it is `ethereumAddresses`,
 * not `addresses` as the spec assumed. Addresses are only present for users
 * who explicitly shared them with the project, AND only when the request
 * carries a valid `apiKey`; an unauthenticated request silently omits them.
 */
export interface HighSignalUser {
  username: string;
  displayName: string;
  rank: number;
  /** The 0–100 Community Contribution score (Discord + Forum combined). */
  score: number;
  /**
   * Coarse contribution tier the API assigns each user — `low` | `mid` | `high`.
   * Used (not the raw 0–100 score) to gate inclusion in the Ethereum Communities
   * cohort. Typed as a raw string because the API's casing is not guaranteed;
   * always read it through {@link parseSignalTier} / {@link signalMeetsThreshold}.
   */
  signal?: string;
  ethereumAddresses?: string[];
  /** Older/alternate spelling — tolerated so a schema change cannot silently break matching. */
  addresses?: string[];
  /** ~360 days of daily scores, newest first. Absent on some records. */
  historicalScores?: HighSignalHistoricalScore[];
}

/** The HighSignal `signal` tiers, in ascending order of contribution. */
export type SignalTier = 'low' | 'mid' | 'high';

/** Ascending inclusion order — index doubles as the comparable rank. */
export const SIGNAL_TIERS: readonly SignalTier[] = ['low', 'mid', 'high'];

/** Parse a raw API `signal` value to a known tier, or null if absent/unrecognized. */
export function parseSignalTier(raw: unknown): SignalTier | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  const i = SIGNAL_TIERS.indexOf(v as SignalTier);
  return i === -1 ? null : SIGNAL_TIERS[i]!;
}

/**
 * True when `raw` is a recognized tier at or above `min`.
 *
 * An absent or unrecognized signal counts as *below* every threshold: voting
 * power is only granted to a user whose tier we can positively confirm meets
 * the bar, so a missing field never leaks power to an unqualified user.
 */
export function signalMeetsThreshold(raw: unknown, min: SignalTier): boolean {
  const tier = parseSignalTier(raw);
  return tier !== null && SIGNAL_TIERS.indexOf(tier) >= SIGNAL_TIERS.indexOf(min);
}

/** Every address a record exposes, lowercased. Tolerates either field name. */
export function addressesOf(user: HighSignalUser): string[] {
  const raw = [...(user.ethereumAddresses ?? []), ...(user.addresses ?? [])];
  return raw.filter((a): a is string => typeof a === 'string' && a.length > 0).map((a) => a.toLowerCase());
}

export interface HighSignalPage {
  data: HighSignalUser[];
  maxPage: number;
  totalResults: number;
  currentPage: number;
  resultsPerPage: number;
}

/**
 * Source of the Community pillar, backed by HttpHighSignalProvider —
 * the live paginated HighSignal API.
 */
export interface HighSignalProvider {
  readonly name: string;
  /**
   * Scores for `addresses`, stamped with `collectionDate`.
   * Addresses with no matching HighSignal user are simply omitted — the
   * Community pillar is then null for that delegate, not zero.
   */
  fetchScores(addresses: string[], collectionDate: string): Promise<HighSignalRow[]>;
  /**
   * Deduped published eth addresses of users whose `signal` tier is `minSignal`
   * or higher, across the given other-community `projects`, for the Ethereum
   * Communities delegation cohort. Returns [] when `projects` is empty.
   */
  fetchEthCommunityAddresses(projects: string[], minSignal: SignalTier): Promise<EthCommunityRow[]>;
  /**
   * For each delegate that matched a HighSignal user, the *extra* eth addresses
   * that user published (excluding the delegate's primary address). Only
   * delegates with at least one extra address are returned.
   */
  fetchIdentities(addresses: string[]): Promise<IdentityRow[]>;
}
