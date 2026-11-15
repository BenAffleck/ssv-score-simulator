/**
 * Read the production pipeline's database (ssv-scoring `pipeline.sqlite`) into
 * a simulator dataset. Read-only: the database is opened with `readonly`, so
 * importing never touches production state.
 *
 * Production freezes one Dataset per run, holding only what that as-of needs.
 * The simulator wants every as-of, so it reads the full history from the store
 * and applies the same cutoffs as production's freeze at scoring time.
 */
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import {
  DATASET_VERSION,
  decimalSumToNumber,
  fromRunExport,
  parseDelegation,
  parseParams,
  toChangePoints,
  type Candidate,
  type CohortKey,
  type Dataset,
  type ProductionRun,
} from '../scoring-core/index.js';

/** The schema this importer reads: production migration 0012. */
const SCHEMA_VERSION = 12;
const SPACE = 'mainnet.ssvnetwork.eth';
/** Production treats a seeded name like `0x13c3...2be1` as a placeholder. */
const SHORT_ADDRESS = /^0x[0-9a-fA-F]+\.\.\.[0-9a-fA-F]+$/;

export interface PublishedRun {
  runId: number;
  asOf: string;
  codeVersion: string;
}

export function openPipeline(path: string): Database.Database {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `${path} is at schema ${version}; this importer reads ${SCHEMA_VERSION}. Run production once to migrate it.`,
    );
  }
  return db;
}

export function publishedRuns(db: Database.Database): PublishedRun[] {
  return db
    .prepare(
      "SELECT run_id AS runId, as_of AS asOf, code_version AS codeVersion FROM runs WHERE status = 'published' ORDER BY run_id",
    )
    .all() as PublishedRun[];
}

/** The full-history dataset, with allocation inputs and baseline from `runId` (default: latest). */
export function readPipeline(db: Database.Database, runId?: number): Dataset {
  const runs = publishedRuns(db);
  const run = runId === undefined ? runs.at(-1) : runs.find((r) => r.runId === runId);
  if (!run) throw new Error(runId === undefined ? 'no published run yet' : `run ${runId} is not published`);
  const frozen = runExport(db, run.runId);
  const frozenDataset = fromRunExport(frozen);

  const roster = readRoster(db);
  const inRoster = new Set(roster.map((c) => c.address));

  const proposals = db
    .prepare('SELECT proposal_id AS id, title, end_ts AS end FROM proposals WHERE NOT flagged ORDER BY end_ts')
    .all() as Dataset['proposals'];
  const proposalIds = new Set(proposals.map((p) => p.id));
  const votes = (
    db.prepare('SELECT proposal_id AS proposalId, voter, created FROM votes ORDER BY created').all() as Dataset['votes']
  ).filter((v) => inRoster.has(v.voter) && proposalIds.has(v.proposalId));

  const community = (
    db
      .prepare(
        'SELECT address, date, score, hs_username AS hsUsername, hs_rank AS hsRank FROM highsignal_scores ORDER BY address, date',
      )
      .all() as Dataset['community']
  ).filter((o) => inRoster.has(o.address));

  const balanceRows = (
    db.prepare('SELECT address, date, ssv_erc20 AS ssv, cssv FROM balances').all() as Array<{
      address: string;
      date: string;
      ssv: string;
      cssv: string;
    }>
  ).filter((b) => inRoster.has(b.address));
  const balanceDates = (
    db.prepare('SELECT DISTINCT date FROM balances ORDER BY date').all() as Array<{ date: string }>
  ).map((r) => r.date);

  const identities = db
    .prepare('SELECT address, hs_username AS hsUsername FROM identities ORDER BY address, hs_username')
    .all() as Dataset['identities'];

  const pools = new Map<string, number>();
  for (const r of runs) {
    try {
      pools.set(r.asOf, fromRunExport(runExport(db, r.runId)).pools[0]!.pool);
    } catch {
      // The earliest runs predate a frozen pool or delegation config; they set no pool.
    }
  }

  return {
    version: DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    origin: `production database, run ${run.runId}`,
    space: SPACE,
    dateRange: {
      start: balanceDates[0] ?? run.asOf,
      end: [balanceDates.at(-1) ?? run.asOf, run.asOf].sort().at(-1)!,
    },
    roster,
    proposals,
    votes,
    community,
    balanceDates,
    balances: toChangePoints(
      balanceRows.map((b) => ({ address: b.address, date: b.date, total: decimalSumToNumber(b.ssv, b.cssv) })),
    ),
    identities,
    nominations: frozenDataset.nominations,
    ethCommunity: frozenDataset.ethCommunity,
    optedOut: frozenDataset.optedOut,
    safeDelegators: frozenDataset.safeDelegators,
    pools: [...pools].sort(([a], [b]) => (a < b ? -1 : 1)).map(([asOf, pool]) => ({ asOf, pool })),
    production: baseline(db, run, frozen),
  };
}

/** A run as `ssv-score export-dataset` writes it. */
export function runExport(db: Database.Database, runId: number): Record<string, unknown> {
  const row = db
    .prepare(
      `SELECT r.run_id, r.as_of, r.code_version, r.params_json, r.delegation_json, i.dataset
       FROM runs r JOIN run_inputs i USING (run_id) WHERE r.run_id = ?`,
    )
    .get(runId) as
    | {
        run_id: number;
        as_of: string;
        code_version: string;
        params_json: string;
        delegation_json: string | null;
        dataset: Buffer;
      }
    | undefined;
  if (!row) throw new Error(`run ${runId} has no frozen dataset`);
  if (row.delegation_json === null) throw new Error(`run ${runId} was published without a delegation config`);
  const dataset = JSON.parse(gunzipSync(row.dataset).toString('utf8')) as Record<string, unknown>;
  const delegation = JSON.parse(row.delegation_json) as Record<string, unknown>;
  // Runs from before the pool was read from the Safe froze it in the delegation config.
  if ('pool' in delegation) {
    dataset.pool = String(delegation.pool);
    delete delegation.pool;
  }
  return {
    runId: row.run_id,
    asOf: row.as_of,
    codeVersion: row.code_version,
    params: JSON.parse(row.params_json),
    delegation,
    dataset,
  };
}

/** The run's config and published rows. */
export function baseline(
  db: Database.Database,
  run: PublishedRun,
  frozen: Record<string, unknown>,
): ProductionRun {
  const rows = db
    .prepare('SELECT address, rank, score, cohort, power FROM scores WHERE run_id = ? ORDER BY rank IS NULL, rank, address')
    .all(run.runId) as Array<{
    address: string;
    rank: number | null;
    score: number | null;
    cohort: CohortKey | null;
    power: number | null;
  }>;
  return {
    runId: run.runId,
    asOf: run.asOf,
    codeVersion: run.codeVersion,
    params: parseParams(frozen.params),
    delegation: parseDelegation(frozen.delegation),
    rows: rows.map((r) => ({ ...r, power: r.power ?? 0 })),
  };
}

function readRoster(db: Database.Database): Candidate[] {
  const rows = db
    .prepare(
      `SELECT address, hs_display_name, ens_name, display_name, hs_username, forum_handle,
              discord_handle, hs_discord_handle
       FROM candidates ORDER BY seed_order IS NULL, seed_order, first_seen, address`,
    )
    .all() as Array<Record<string, string | null>>;
  const sources = new Map<string, string[]>();
  for (const s of db
    .prepare('SELECT address, source FROM candidate_sources ORDER BY address, source')
    .all() as Array<{ address: string; source: string }>) {
    const list = sources.get(s.address) ?? [];
    list.push(s.source);
    sources.set(s.address, list);
  }
  return rows.map((r) => {
    const address = r.address!;
    const seeded = r.display_name && !SHORT_ADDRESS.test(r.display_name) ? r.display_name : null;
    return {
      address,
      displayName: r.hs_display_name || r.ens_name || seeded || r.hs_username || address,
      sources: sources.get(address) ?? [],
      forumHandle: r.forum_handle || null,
      discordHandle: r.hs_discord_handle || r.discord_handle || null,
      ensName: r.ens_name || null,
    };
  });
}
