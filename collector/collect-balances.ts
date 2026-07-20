/**
 * Historical balance backfill: one row per (delegate, UTC day) with the three
 * holdings components read at that day's block via the archive RPC.
 */
import { pathToFileURL } from 'node:url';
import {
  BACKFILL_DAYS,
  CSSV_DEPLOY_BLOCK,
  DELEGATES_CSV,
  SQLITE_PATH,
  requireTokenAddresses,
} from '../config.js';
import { addDays, todayUtc } from '../scoring-core/dates.js';
import type { BalanceRow, DelegateRow } from '../scoring-core/types.js';
import { existingBalanceDates, openDb, upsertBalances, upsertDelegates, type DB } from './db.js';
import { loadDelegates } from './delegates.js';
import { blockForDate, makeClient, readBalancesAt } from './rpc.js';
import { log } from './util.js';

export interface BalanceCollectOptions {
  days?: number;
  endDate?: string;
  /** Re-read days already stored (default: skip them, making re-runs cheap). */
  force?: boolean;
}

export async function collectBalances(
  db: DB,
  delegates: DelegateRow[],
  opts: BalanceCollectOptions = {},
): Promise<number> {
  // Fail fast before any network work: a missing cSSV address must never
  // silently reduce the holdings base (SPEC §9).
  const tokens = requireTokenAddresses();
  const client = makeClient();

  const days = opts.days ?? BACKFILL_DAYS;
  const end = opts.endDate ?? todayUtc();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(addDays(end, -i));

  const addresses = delegates.map((d) => d.address.toLowerCase());
  log('balances', `backfilling ${dates.length} day(s) × ${addresses.length} delegate(s)`);
  log('balances', `SSV=${tokens.ssv} cSSV=${tokens.cssv}`);

  // Days already stored for every delegate can be skipped wholesale.
  const stored = new Map(addresses.map((a) => [a, existingBalanceDates(db, a)]));
  const todo = opts.force
    ? dates
    : dates.filter((d) => addresses.some((a) => !stored.get(a)!.has(d)));

  if (todo.length < dates.length) {
    log('balances', `${dates.length - todo.length} day(s) already collected — skipping`);
  }

  let written = 0;
  let lowerBound = 1n;
  // Fetched once instead of per-day: the head does not move meaningfully
  // relative to a daily backfill, and this is one fewer call per date.
  const latestBlock = await client.getBlockNumber();

  let announcedPreCssv = false;

  for (const [i, date] of todo.entries()) {
    const block = await blockForDate(client, db, date, lowerBound, latestBlock);
    lowerBound = block; // dates ascend, so the next block is never earlier

    if (block < CSSV_DEPLOY_BLOCK && !announcedPreCssv) {
      announcedPreCssv = true;
      log(
        'balances',
        `${date} (block ${block}) predates the cSSV deployment (${CSSV_DEPLOY_BLOCK}) — ` +
          'cSSV counts as 0 until then, which is correct: it did not exist.',
      );
    }

    const balances = await readBalancesAt(client, addresses, block);
    const rows: BalanceRow[] = [];
    for (const [address, triple] of balances) {
      rows.push({ address, date, ...triple });
    }
    upsertBalances(db, rows);
    written += rows.length;

    if (i % 10 === 0 || i === todo.length - 1) {
      log('balances', `${date} (block ${block}) — ${i + 1}/${todo.length}`);
    }
  }

  log('balances', `wrote ${written} balance row(s)`);
  return written;
}

async function main(): Promise<void> {
  const delegates = loadDelegates(DELEGATES_CSV);
  const db = openDb(SQLITE_PATH);
  upsertDelegates(db, delegates);
  await collectBalances(db, delegates);
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
