import type { HighSignalRow } from '../../scoring-core/types.js';

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
  ethereumAddresses?: string[];
  /** Older/alternate spelling — tolerated so a schema change cannot silently break matching. */
  addresses?: string[];
  /** ~360 days of daily scores, newest first. Absent on some records. */
  historicalScores?: HighSignalHistoricalScore[];
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
 * Source of the Community pillar. Two implementations ship:
 *   - HttpHighSignalProvider (default) — the live paginated API
 *   - CsvHighSignalProvider — data/highsignal.csv, for offline runs/backfill
 */
export interface HighSignalProvider {
  readonly name: string;
  /**
   * Scores for `addresses`, stamped with `collectionDate`.
   * Addresses with no matching HighSignal user are simply omitted — the
   * Community pillar is then null for that delegate, not zero.
   */
  fetchScores(addresses: string[], collectionDate: string): Promise<HighSignalRow[]>;
}
