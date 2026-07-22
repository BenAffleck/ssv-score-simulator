/**
 * Validation for a dataset that arrived from outside the collector — a file a
 * peer shared, dropped into the UI by hand.
 *
 * Deliberately stricter than `parsePreset`. A preset is a policy choice, so
 * defaulting its missing keys is helpful. A dataset is the *evidence*: a
 * silently-defaulted or half-parsed one produces a leaderboard that looks
 * authoritative and is wrong. Every problem here is a hard failure that names
 * the offending field, so a truncated or hand-edited file is caught at import
 * rather than showing up later as an unexplained score.
 *
 * Addresses are left exactly as they appear — `indexDataset` lowercases at
 * lookup time, so normalising here would only mask a mismatched roster.
 */
import type {
  BalanceRow,
  Dataset,
  DelegateRow,
  HighSignalRow,
  ProposalRow,
  VoteRow,
} from './types.js';

/** Bumped only if the on-disk dataset shape changes incompatibly. */
export const DATASET_VERSION = 1;

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDataset(input: unknown): Dataset {
  const root = record(input, 'dataset');

  // The most common failure by far: someone exports the wrong JSON file (a
  // preset, an RPC response) and gets a type error thirty frames deep.
  if (!Array.isArray(root.delegates)) {
    throw new DatasetError(
      'Not a dataset file: no "delegates" array.\n' +
        'Expected the JSON written by `npm run collect` (data/dataset.json). ' +
        'A parameter preset is a different file — import that from the sidebar instead.',
    );
  }
  if (root.delegates.length === 0) {
    throw new DatasetError('Dataset contains no delegates — nothing to score.');
  }

  const range = record(root.dateRange, 'dateRange');
  const start = isoDate(range.start, 'dateRange.start');
  const end = isoDate(range.end, 'dateRange.end');
  if (start > end) {
    throw new DatasetError(`dateRange runs backwards: start ${start} is after end ${end}.`);
  }

  return {
    generatedAt: typeof root.generatedAt === 'string' ? root.generatedAt : new Date().toISOString(),
    space: str(root.space, 'space', ''),
    dateRange: { start, end },
    delegates: root.delegates.map(delegate),
    balances: array(root.balances, 'balances').map(balance),
    proposals: array(root.proposals, 'proposals').map(proposal),
    votes: array(root.votes, 'votes').map(vote),
    highsignal: array(root.highsignal, 'highsignal').map(highSignal),
  };
}

/** One-line summary for the import confirmation. */
export function describeDataset(d: Dataset): string {
  return (
    `${d.delegates.length} delegates · ${d.balances.length} balance rows · ` +
    `${d.proposals.length} proposals · ${d.dateRange.start} → ${d.dateRange.end}`
  );
}

// --- Row parsers -----------------------------------------------------------
// Indices are reported 0-based against the JSON array, which is what a reader
// scrolling the file actually sees.

const delegate = (v: unknown, i: number): DelegateRow => {
  const r = record(v, `delegates[${i}]`);
  return {
    address: str(r.address, `delegates[${i}].address`),
    forumHandle: str(r.forumHandle, `delegates[${i}].forumHandle`, ''),
    discordUsername: str(r.discordUsername, `delegates[${i}].discordUsername`, ''),
    displayName: str(r.displayName, `delegates[${i}].displayName`, '') || str(r.address, 'address'),
  };
};

const balance = (v: unknown, i: number): BalanceRow => {
  const r = record(v, `balances[${i}]`);
  return {
    address: str(r.address, `balances[${i}].address`),
    date: isoDate(r.date, `balances[${i}].date`),
    ssvErc20: num(r.ssvErc20, `balances[${i}].ssvErc20`),
    cssv: num(r.cssv, `balances[${i}].cssv`),
  };
};

const proposal = (v: unknown, i: number): ProposalRow => {
  const r = record(v, `proposals[${i}]`);
  return {
    id: str(r.id, `proposals[${i}].id`),
    title: str(r.title, `proposals[${i}].title`, ''),
    endTs: num(r.endTs, `proposals[${i}].endTs`),
  };
};

const vote = (v: unknown, i: number): VoteRow => {
  const r = record(v, `votes[${i}]`);
  return {
    address: str(r.address, `votes[${i}].address`),
    proposalId: str(r.proposalId, `votes[${i}].proposalId`),
    voted: r.voted ? 1 : 0,
  };
};

const highSignal = (v: unknown, i: number): HighSignalRow => {
  const r = record(v, `highsignal[${i}]`);
  return {
    address: str(r.address, `highsignal[${i}].address`),
    date: isoDate(r.date, `highsignal[${i}].date`),
    score: num(r.score, `highsignal[${i}].score`),
    hsUsername: typeof r.hsUsername === 'string' ? r.hsUsername : null,
    hsRank: Number.isFinite(Number(r.hsRank)) && r.hsRank !== null ? Number(r.hsRank) : null,
  };
};

// --- Primitives ------------------------------------------------------------

function record(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new DatasetError(`${field}: expected an object, got ${describe(v)}.`);
  }
  return v as Record<string, unknown>;
}

function array(v: unknown, field: string): unknown[] {
  if (v === undefined || v === null) return []; // an absent source is legitimately empty
  if (!Array.isArray(v)) throw new DatasetError(`${field}: expected an array, got ${describe(v)}.`);
  return v;
}

function str(v: unknown, field: string, fallback?: string): string {
  if (typeof v === 'string' && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new DatasetError(`${field}: expected a non-empty string, got ${describe(v)}.`);
}

function num(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new DatasetError(`${field}: expected a number, got ${describe(v)}.`);
  return n;
}

function isoDate(v: unknown, field: string): string {
  const s = str(v, field);
  if (!ISO_DATE.test(s)) throw new DatasetError(`${field}: expected YYYY-MM-DD, got "${s}".`);
  return s;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'nothing';
  if (Array.isArray(v)) return 'an array';
  return `${typeof v} (${JSON.stringify(v)?.slice(0, 40) ?? '?'})`;
}
