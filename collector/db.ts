/** SQLite store (SPEC §5). Idempotent upserts so the collector can re-run. */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  BalanceRow,
  DelegateRow,
  HighSignalRow,
  ProposalRow,
  VoteRow,
} from '../scoring-core/types.js';

export type DB = Database.Database;

export function openDb(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS delegates (
      address       TEXT PRIMARY KEY,
      forum_handle  TEXT,
      discord_handle TEXT,
      display_name  TEXT
    );
    CREATE TABLE IF NOT EXISTS balances (
      address     TEXT NOT NULL,
      date        TEXT NOT NULL,
      ssv_erc20   REAL NOT NULL,
      cssv        REAL NOT NULL,
      PRIMARY KEY (address, date)
    );
    CREATE TABLE IF NOT EXISTS proposals (
      proposal_id TEXT PRIMARY KEY,
      title       TEXT,
      end_ts      INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delegate_votes (
      address     TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      voted       INTEGER NOT NULL,
      PRIMARY KEY (address, proposal_id)
    );
    CREATE TABLE IF NOT EXISTS highsignal_scores (
      address     TEXT NOT NULL,
      date        TEXT NOT NULL,
      score       REAL NOT NULL,
      hs_username TEXT,
      hs_rank     INTEGER,
      PRIMARY KEY (address, date)
    );
    -- Block number per UTC date, cached: resolving one costs ~15 RPC calls.
    CREATE TABLE IF NOT EXISTS block_cache (
      date   TEXT PRIMARY KEY,
      block  INTEGER NOT NULL
    );
  `);
  assertCurrentSchema(db, path);
  return db;
}

/**
 * A database written before the vesting component was dropped still has a
 * `NOT NULL` ssv_vesting column, which would make every insert fail with an
 * opaque constraint error. Say so plainly instead.
 */
function assertCurrentSchema(db: DB, path: string): void {
  const columns = db.prepare('PRAGMA table_info(balances)').all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === 'ssv_vesting')) {
    throw new Error(
      `${path} uses the old balances schema (it still has an "ssv_vesting" column).\n` +
        '  → The holdings base is now SSV + cSSV only.\n' +
        `  → Delete the database and re-collect:  rm ${path}`,
    );
  }
}

const norm = (a: string): string => a.toLowerCase();

export function upsertDelegates(db: DB, rows: DelegateRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO delegates (address, forum_handle, discord_handle, display_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      forum_handle = excluded.forum_handle,
      discord_handle = excluded.discord_handle,
      display_name = excluded.display_name
  `);
  db.transaction((items: DelegateRow[]) => {
    for (const d of items) stmt.run(norm(d.address), d.forumHandle, d.discordUsername, d.displayName);
  })(rows);
}

export function upsertBalances(db: DB, rows: BalanceRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO balances (address, date, ssv_erc20, cssv)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(address, date) DO UPDATE SET
      ssv_erc20 = excluded.ssv_erc20,
      cssv = excluded.cssv
  `);
  db.transaction((items: BalanceRow[]) => {
    for (const b of items) stmt.run(norm(b.address), b.date, b.ssvErc20, b.cssv);
  })(rows);
}

export function upsertProposals(db: DB, rows: ProposalRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO proposals (proposal_id, title, end_ts) VALUES (?, ?, ?)
    ON CONFLICT(proposal_id) DO UPDATE SET title = excluded.title, end_ts = excluded.end_ts
  `);
  db.transaction((items: ProposalRow[]) => {
    for (const p of items) stmt.run(p.id, p.title, p.endTs);
  })(rows);
}

export function upsertVotes(db: DB, rows: VoteRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO delegate_votes (address, proposal_id, voted) VALUES (?, ?, ?)
    ON CONFLICT(address, proposal_id) DO UPDATE SET voted = excluded.voted
  `);
  db.transaction((items: VoteRow[]) => {
    for (const v of items) stmt.run(norm(v.address), v.proposalId, v.voted);
  })(rows);
}

export function upsertHighSignal(db: DB, rows: HighSignalRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO highsignal_scores (address, date, score, hs_username, hs_rank)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(address, date) DO UPDATE SET
      score = excluded.score, hs_username = excluded.hs_username, hs_rank = excluded.hs_rank
  `);
  db.transaction((items: HighSignalRow[]) => {
    for (const h of items) stmt.run(norm(h.address), h.date, h.score, h.hsUsername, h.hsRank);
  })(rows);
}

export function getCachedBlock(db: DB, date: string): number | null {
  const row = db.prepare('SELECT block FROM block_cache WHERE date = ?').get(date) as
    | { block: number }
    | undefined;
  return row?.block ?? null;
}

export function cacheBlock(db: DB, date: string, block: number): void {
  db.prepare('INSERT OR REPLACE INTO block_cache (date, block) VALUES (?, ?)').run(date, block);
}

/** Dates for which this address already has a balance row — skip on re-runs. */
export function existingBalanceDates(db: DB, address: string): Set<string> {
  const rows = db.prepare('SELECT date FROM balances WHERE address = ?').all(norm(address)) as Array<{
    date: string;
  }>;
  return new Set(rows.map((r) => r.date));
}

// --- Readers used to emit dataset.json -------------------------------------

export function readAll(db: DB): {
  delegates: DelegateRow[];
  balances: BalanceRow[];
  proposals: ProposalRow[];
  votes: VoteRow[];
  highsignal: HighSignalRow[];
} {
  const delegates = (
    db.prepare('SELECT * FROM delegates ORDER BY address').all() as Array<Record<string, string>>
  ).map((r) => ({
    address: r.address!,
    forumHandle: r.forum_handle ?? '',
    discordUsername: r.discord_handle ?? '',
    displayName: r.display_name ?? '',
  }));

  const balances = (
    db.prepare('SELECT * FROM balances ORDER BY address, date').all() as Array<Record<string, never>>
  ).map((r: any) => ({
    address: r.address as string,
    date: r.date as string,
    ssvErc20: r.ssv_erc20 as number,
    cssv: r.cssv as number,
  }));

  const proposals = (db.prepare('SELECT * FROM proposals ORDER BY end_ts DESC').all() as any[]).map(
    (r) => ({ id: r.proposal_id as string, title: r.title as string, endTs: r.end_ts as number }),
  );

  const votes = (db.prepare('SELECT * FROM delegate_votes').all() as any[]).map((r) => ({
    address: r.address as string,
    proposalId: r.proposal_id as string,
    voted: (r.voted ? 1 : 0) as 0 | 1,
  }));

  const highsignal = (
    db.prepare('SELECT * FROM highsignal_scores ORDER BY address, date').all() as any[]
  ).map((r) => ({
    address: r.address as string,
    date: r.date as string,
    score: r.score as number,
    hsUsername: (r.hs_username ?? null) as string | null,
    hsRank: (r.hs_rank ?? null) as number | null,
  }));

  return { delegates, balances, proposals, votes, highsignal };
}
