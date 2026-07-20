/** Shared types for the scoring core and the dataset it consumes. Pure — no I/O. */

export type CommunityMode = 'native' | 'minmax' | 'refcap';
export type HoldingsMode = 'power' | 'log';

/**
 * How to treat a pillar that is live roster-wide but has no data for ONE
 * delegate (e.g. a delegate with no HighSignal profile).
 *
 *  - 'zero'    : count it as 0. Missing data can never improve a rank.
 *  - 'exclude' : drop it from that delegate's weighted average.
 *
 * 'exclude' is the intuitive-sounding option and is WRONG for a ranking: it
 * makes "no data" strictly better than "measured but low", so a delegate with
 * no community profile outranks one who has a real, low score. It stays
 * available as a lever so the effect can be demonstrated, but 'zero' is the
 * default.
 *
 * This is separate from the proposal's graceful degradation, which is
 * pillar-level: a pillar with no data for ANY delegate (source not configured)
 * is excluded for everyone regardless of this setting.
 */
export type MissingPolicy = 'zero' | 'exclude';

export interface ScoringParams {
  weights: { community: number; holdings: number; votes: number };
  holdings: {
    /** Holding that scores 100 (HOLD_REF). */
    ref: number;
    /** Concavity exponent p. 0.5 = sqrt (proposal default), 1.0 = linear. */
    concavity: number;
    /** 'power' = 100·min(1,(TWAB/ref)^p); 'log' = 100·min(1, ln(1+TWAB)/ln(1+ref)). */
    mode: HoldingsMode;
    /** TWAB lookback window T, in days. */
    windowDays: number;
  };
  votes: {
    /** Recency half-life H, in days. */
    halfLifeDays: number;
    /** Proposal window N — the N most recent closed proposals at or before asOf. */
    windowN: number;
  };
  community: {
    mode: CommunityMode;
    /** Reference score for 'refcap' mode. */
    refValue: number;
  };
  /** Delegate-level missing-data handling. See MissingPolicy. */
  missingPolicy: MissingPolicy;
}

// --- Dataset (emitted by the collector, consumed by the UI) ----------------

export interface DelegateRow {
  address: string;
  forumHandle: string;
  discordUsername: string;
  displayName: string;
}

export interface BalanceRow {
  address: string;
  /** ISO date, YYYY-MM-DD (UTC). */
  date: string;
  ssvErc20: number;
  cssv: number;
}

export interface ProposalRow {
  id: string;
  title: string;
  /** Unix seconds — proposal close time. */
  endTs: number;
}

export interface VoteRow {
  address: string;
  proposalId: string;
  voted: 0 | 1;
}

export interface HighSignalRow {
  address: string;
  /** Collection date, YYYY-MM-DD. */
  date: string;
  score: number;
  hsUsername: string | null;
  hsRank: number | null;
}

export interface Dataset {
  generatedAt: string;
  space: string;
  dateRange: { start: string; end: string };
  delegates: DelegateRow[];
  balances: BalanceRow[];
  proposals: ProposalRow[];
  votes: VoteRow[];
  highsignal: HighSignalRow[];
}

// --- Results ---------------------------------------------------------------

export interface PillarScores {
  /** null = no data as of this date → pillar excluded from the weighted average. */
  community: number | null;
  holdings: number | null;
  votes: number | null;
}

export interface LeaderboardRow {
  address: string;
  displayName: string;
  forumHandle: string;
  score: number | null;
  pillars: PillarScores;
  /** True where this delegate had no data and the value shown was imputed. */
  missing: { community: boolean; holdings: boolean; votes: boolean };
  /** Raw inputs behind the pillars, for auditability/tooltips. */
  raw: {
    twab: number | null;
    /** Days the TWAB actually averaged over — less than T when history is short. */
    twabDays: number;
    communityRaw: number | null;
    votedCount: number;
    proposalCount: number;
    hsUsername: string | null;
    hsRank: number | null;
  };
}
