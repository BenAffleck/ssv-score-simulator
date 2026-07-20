/**
 * `npm run seed:demo` — writes a synthetic data/dataset.json.
 *
 * Not part of the spec: it exists so the UI can be launched and the levers
 * exercised without an archive RPC or a HighSignal key. The shape is identical
 * to what `npm run collect` emits, so the UI cannot tell the difference.
 * Real runs overwrite it.
 */
import { writeFileSync } from 'node:fs';
import { DATASET_PATH, SNAPSHOT_SPACE } from '../config.js';
import { DAY_SECONDS, addDays, dateToTs, todayUtc } from '../scoring-core/dates.js';
import type { BalanceRow, Dataset, HighSignalRow, VoteRow } from '../scoring-core/types.js';
import { log } from './util.js';

const DAYS = 240;
const END = todayUtc();
const START = addDays(END, -(DAYS - 1));

/** Deterministic PRNG so repeated seeds produce a stable dataset. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

interface Persona {
  address: string;
  displayName: string;
  forumHandle: string;
  /** Holdings base on day `i` (0 = oldest). */
  balance: (i: number) => number;
  community: number;
  /** Probability of voting on a proposal that closed `ageDays` ago. */
  turnout: (ageDays: number) => number;
  hasCommunity?: boolean;
}

const PERSONAS: Persona[] = [
  {
    address: '0x1111111111111111111111111111111111111111',
    displayName: 'Steady Hand',
    forumHandle: 'steady',
    balance: () => 12_000,
    community: 82,
    turnout: () => 0.95,
  },
  {
    address: '0x2222222222222222222222222222222222222222',
    displayName: 'The Whale',
    forumHandle: 'whale',
    balance: () => 1_000_000,
    community: 41,
    turnout: () => 0.6,
  },
  {
    address: '0x3333333333333333333333333333333333333333',
    displayName: 'Late Buyer',
    forumHandle: 'latebuyer',
    // Buys a large position only in the last three weeks.
    balance: (i) => (i > DAYS - 21 ? 250_000 : 0),
    community: 55,
    turnout: () => 0.7,
  },
  {
    address: '0x4444444444444444444444444444444444444444',
    displayName: 'Faded Veteran',
    forumHandle: 'veteran',
    balance: () => 8_000,
    community: 64,
    // Voted on everything old, nothing recent — the recency lever should bite.
    turnout: (age) => (age > 120 ? 1 : 0),
  },
  {
    address: '0x5555555555555555555555555555555555555555',
    displayName: 'Rising Contributor',
    forumHandle: 'riser',
    balance: (i) => 500 + i * 12,
    community: 91,
    turnout: (age) => (age < 100 ? 1 : 0.3),
  },
  {
    address: '0x6666666666666666666666666666666666666666',
    displayName: 'Quiet Holder',
    forumHandle: 'quiet',
    balance: () => 3_200,
    community: 12,
    turnout: () => 0.45,
  },
  {
    address: '0x7777777777777777777777777777777777777777',
    displayName: 'Forum Voice',
    forumHandle: 'voice',
    balance: () => 150,
    community: 97,
    turnout: () => 0.85,
  },
  {
    address: '0x8888888888888888888888888888888888888888',
    displayName: 'Unlisted Newcomer',
    forumHandle: 'newcomer',
    balance: (i) => (i > DAYS - 60 ? 4_000 : 0),
    community: 0,
    // No HighSignal profile → community pillar is null, not zero.
    hasCommunity: false,
    turnout: (age) => (age < 60 ? 1 : 0),
  },
];

function build(): Dataset {
  const rand = rng(20_260_720);

  const delegates = PERSONAS.map((p) => ({
    address: p.address,
    forumHandle: p.forumHandle,
    discordUsername: `${p.forumHandle}#0001`,
    displayName: p.displayName,
  }));

  // 12 closed proposals, roughly every 20 days.
  const proposals = Array.from({ length: 12 }, (_, i) => ({
    id: `0xproposal${String(i).padStart(2, '0')}`,
    title: `SSV DAO Proposal #${12 - i}`,
    endTs: dateToTs(END) - i * 20 * DAY_SECONDS,
  }));

  const balances: BalanceRow[] = [];
  const votes: VoteRow[] = [];
  const highsignal: HighSignalRow[] = [];

  for (const p of PERSONAS) {
    for (let i = 0; i < DAYS; i++) {
      const total = p.balance(i) * (0.97 + rand() * 0.06); // mild noise
      balances.push({
        address: p.address,
        date: addDays(START, i),
        // Split across both components so the UI exercises the full base.
        ssvErc20: round(total * 0.55),
        cssv: round(total * 0.45),
      });
    }

    for (const prop of proposals) {
      const ageDays = (dateToTs(END) - prop.endTs) / DAY_SECONDS;
      votes.push({
        address: p.address,
        proposalId: prop.id,
        voted: rand() < p.turnout(ageDays) ? 1 : 0,
      });
    }

    // HighSignal accrues forward from each run: monthly observations that
    // drift, mirroring a series built up over several collector runs.
    if (p.hasCommunity !== false) {
      for (let i = 0; i < DAYS; i += 30) {
        const progress = i / DAYS;
        const drift = (p.community - 50) * 0.35 * (1 - progress);
        highsignal.push({
          address: p.address,
          date: addDays(START, i),
          score: clamp(round(p.community - drift + (rand() - 0.5) * 4)),
          hsUsername: p.forumHandle,
          hsRank: 0,
        });
      }
      highsignal.push({
        address: p.address,
        date: END,
        score: p.community,
        hsUsername: p.forumHandle,
        hsRank: 0,
      });
    }
  }

  // Rank by the latest community score, as HighSignal would.
  const latest = highsignal.filter((h) => h.date === END).sort((a, b) => b.score - a.score);
  latest.forEach((row, i) => (row.hsRank = i + 1));

  return {
    generatedAt: new Date().toISOString(),
    space: SNAPSHOT_SPACE,
    dateRange: { start: START, end: END },
    delegates,
    balances,
    proposals,
    votes,
    highsignal,
  };
}

const round = (x: number): number => Math.round(x * 100) / 100;
const clamp = (x: number): number => Math.min(100, Math.max(0, x));

const dataset = build();
writeFileSync(DATASET_PATH, JSON.stringify(dataset, null, 2));
log('seed', `wrote demo dataset → ${DATASET_PATH}`);
log(
  'seed',
  `  ${dataset.delegates.length} delegates | ${dataset.balances.length} balance rows | ` +
    `${dataset.proposals.length} proposals | ${dataset.highsignal.length} highsignal rows`,
);
log('seed', `  range ${dataset.dateRange.start} → ${dataset.dateRange.end}`);
log('seed', 'This is synthetic data — run `npm run collect` for the real thing.');
