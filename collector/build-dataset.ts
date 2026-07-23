/**
 * `npm run collect` — the orchestrator.
 *
 * Loads the roster, backfills balances + votes + HighSignal into
 * data/sim.sqlite, then emits data/dataset.json for the UI.
 */
import { writeFileSync } from 'node:fs';
import {
  BACKFILL_DAYS,
  DATASET_PATH,
  DELEGATES_CSV,
  HIGHSIGNAL_ETH_MIN_SIGNAL,
  HIGHSIGNAL_ETH_PROJECTS,
  SNAPSHOT_SPACE,
  SQLITE_PATH,
  requireArchiveRpcUrl,
  requireTokenAddresses,
} from '../config.js';
import { addDays, todayUtc } from '../scoring-core/dates.js';
import type { Dataset } from '../scoring-core/types.js';
import { collectBalances } from './collect-balances.js';
import { collectVotes } from './collect-votes.js';
import {
  openDb,
  readAll,
  replaceEthCommunities,
  replaceIdentities,
  upsertDelegates,
  upsertHighSignal,
} from './db.js';
import { loadDelegates } from './delegates.js';
import { makeHighSignalProvider } from './highsignal/index.js';
import { errMessage, log } from './util.js';

interface CliOptions {
  days: number;
  skipBalances: boolean;
  skipVotes: boolean;
  skipHighSignal: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const has = (flag: string) => argv.includes(flag);
  const daysArg = argv.find((a) => a.startsWith('--days='));
  return {
    days: daysArg ? Number(daysArg.split('=')[1]) : BACKFILL_DAYS,
    skipBalances: has('--skip-balances'),
    skipVotes: has('--skip-votes'),
    skipHighSignal: has('--skip-highsignal'),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // ---- Fail fast on required config, before any slow work ----------------
  const tokens = requireTokenAddresses();
  if (!opts.skipBalances) requireArchiveRpcUrl();

  const delegates = loadDelegates(DELEGATES_CSV);
  log('collect', `roster: ${delegates.length} delegate(s) from ${DELEGATES_CSV}`);
  log('collect', `space: ${SNAPSHOT_SPACE} | cSSV: ${tokens.cssv} | window: ${opts.days}d`);

  const db = openDb(SQLITE_PATH);
  upsertDelegates(db, delegates);

  // ---- Balances (archive RPC) --------------------------------------------
  if (opts.skipBalances) log('collect', 'skipping balances (--skip-balances)');
  else await collectBalances(db, delegates, { days: opts.days });

  // ---- Votes (Snapshot GraphQL) ------------------------------------------
  if (opts.skipVotes) log('collect', 'skipping votes (--skip-votes)');
  else await collectVotes(db, delegates, SNAPSHOT_SPACE);

  // ---- Community (HighSignal) --------------------------------------------
  if (opts.skipHighSignal) {
    log('collect', 'skipping highsignal (--skip-highsignal)');
  } else {
    const provider = makeHighSignalProvider();
    log('collect', `highsignal provider: ${provider.name}`);
    const rows = await provider.fetchScores(
      delegates.map((d) => d.address),
      todayUtc(),
    );
    upsertHighSignal(db, rows);
    log('collect', `wrote ${rows.length} highsignal row(s) dated ${todayUtc()}`);

    // ---- Linked eth addresses per identity (HighSignal) ------------------
    const identities = await provider.fetchIdentities(delegates.map((d) => d.address));
    replaceIdentities(db, identities);
    log('collect', `wrote linked addresses for ${identities.length} identit(ies)`);

    // ---- Ethereum Communities cohort (other HighSignal projects) ---------
    if (HIGHSIGNAL_ETH_PROJECTS.length === 0) {
      log('collect', 'no HIGHSIGNAL_ETH_PROJECTS configured — eth communities cohort left empty');
    } else {
      const eth = await provider.fetchEthCommunityAddresses(
        HIGHSIGNAL_ETH_PROJECTS,
        HIGHSIGNAL_ETH_MIN_SIGNAL,
      );
      replaceEthCommunities(db, eth);
      log(
        'collect',
        `wrote ${eth.length} eth community address(es) from ${HIGHSIGNAL_ETH_PROJECTS.length} project(s)`,
      );
    }
  }

  // ---- Emit dataset.json --------------------------------------------------
  const all = readAll(db);
  const dates = all.balances.map((b) => b.date).sort();
  const dataset: Dataset = {
    generatedAt: new Date().toISOString(),
    space: SNAPSHOT_SPACE,
    dateRange: {
      start: dates[0] ?? addDays(todayUtc(), -opts.days + 1),
      end: dates.at(-1) ?? todayUtc(),
    },
    ...all,
  };

  writeFileSync(DATASET_PATH, JSON.stringify(dataset, null, 2));
  db.close();

  log('collect', `wrote ${DATASET_PATH}`);
  log(
    'collect',
    `  ${dataset.delegates.length} delegates | ${dataset.balances.length} balance rows | ` +
      `${dataset.proposals.length} proposals | ${dataset.votes.length} vote rows | ` +
      `${dataset.highsignal.length} highsignal rows | ${dataset.ethCommunities?.length ?? 0} eth community rows | ` +
      `${dataset.identities?.length ?? 0} linked identities`,
  );
  log('collect', `  range ${dataset.dateRange.start} → ${dataset.dateRange.end}`);
}

main().catch((err) => {
  console.error(`\n✖ collect failed: ${errMessage(err)}\n`);
  process.exit(1);
});
