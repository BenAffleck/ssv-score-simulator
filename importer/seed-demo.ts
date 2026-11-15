/**
 * `npm run seed:demo` — a synthetic `data/dataset.json`, so the UI runs without
 * access to production's database. Deterministic; nothing in it is real.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  addDays,
  DATASET_VERSION,
  DAY_SECONDS,
  DEFAULT_DELEGATION,
  DEFAULT_PARAMS,
  endOfDay,
  toChangePoints,
  type Dataset,
} from '../scoring-core/index.js';

const END = '2026-11-02';
const DAYS = 120;
const START = addDays(END, -(DAYS - 1));
const SOURCES = ['grandfathered', 'snapshot_voter', 'snapshot_follower', 'highsignal_ssv', 'highsignal_eth:lido'];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const hex = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;

const roster = Array.from({ length: 120 }, (_, i) => ({
  address: hex(i + 1),
  displayName: `Delegate ${i + 1}`,
  sources: [SOURCES[i % SOURCES.length]!],
  forumHandle: null,
  discordHandle: null,
  ensName: i % 7 === 0 ? `delegate${i + 1}.eth` : null,
}));
const proposals = Array.from({ length: 30 }, (_, i) => ({
  id: `demo-${i}`,
  title: `Demo proposal ${i + 1}`,
  end: endOfDay(END) - 3600 - i * 9 * DAY_SECONDS,
}));
const votes = roster.flatMap((c, i) => {
  const turnout = (i % 10) / 10;
  return proposals.filter(() => rand() < turnout).map((p) => ({ proposalId: p.id, voter: c.address, created: p.end - 600 }));
});
const balances = roster.flatMap((c, i) => {
  const base = i % 3 === 0 ? 0 : Math.round(rand() ** 3 * 40_000);
  const buyDay = Math.floor(rand() * DAYS);
  return Array.from({ length: DAYS }, (_, d) => ({
    address: c.address,
    date: addDays(START, d),
    total: d >= buyDay && i % 5 === 0 ? base + 5_000 : base,
  }));
});
const community = roster
  .filter((_, i) => i % 6 === 0)
  .flatMap((c, i) =>
    Array.from({ length: DAYS }, (_, d) => ({
      address: c.address,
      date: addDays(START, d),
      score: Math.min(100, 20 + i * 8 + Math.floor(d / 20)),
      hsUsername: `user${i}`,
      hsRank: i + 1,
    })),
  );

const dataset: Dataset = {
  version: DATASET_VERSION,
  generatedAt: new Date().toISOString(),
  origin: 'synthetic demo',
  space: 'demo',
  dateRange: { start: START, end: END },
  roster,
  proposals,
  votes,
  community,
  balanceDates: Array.from({ length: DAYS }, (_, d) => addDays(START, d)),
  balances: toChangePoints(balances),
  identities: [
    { address: hex(1), hsUsername: 'user0' },
    { address: hex(2), hsUsername: 'user0' },
  ],
  nominations: [
    ...[3, 4, 5, 6, 7].map((i) => ({ address: hex(i), cohort: 'verifiedOperators' as const })),
    { address: hex(8), cohort: 'professional' as const },
    ...[9, 10, 11].map((i) => ({ address: hex(i), cohort: 'grantRecipients' as const })),
  ],
  ethCommunity: roster.filter((c) => c.sources[0]!.startsWith('highsignal_eth')).map((c) => c.address),
  optedOut: [hex(12)],
  safeDelegators: [hex(13)],
  pools: [{ asOf: END, pool: 300_000 }],
  production: { runId: 0, asOf: END, codeVersion: 'demo', params: DEFAULT_PARAMS, delegation: DEFAULT_DELEGATION, rows: [] },
};

mkdirSync('data', { recursive: true });
writeFileSync('data/demo-dataset.json', JSON.stringify(dataset));
console.log('✔ wrote data/demo-dataset.json (synthetic) — drop it on the simulator, or copy it to data/dataset.json');
