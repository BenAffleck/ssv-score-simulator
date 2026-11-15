/**
 * Reading a dataset that arrived from outside: a simulator `dataset.json`
 * (`npm run import`), or a production run export (`ssv-score export-dataset`).
 *
 * Strict on purpose. A dataset is the evidence; a half-parsed one yields a
 * leaderboard that looks authoritative and is wrong. Every problem is a hard
 * failure naming the field.
 */
import { decimalSumToNumber } from './decimal.js';
import { parseDelegation, parseNominations, parseParams } from './params.js';
import { cmp } from './prepared.js';
import {
  DATASET_VERSION,
  type BalanceSeries,
  type Candidate,
  type CohortKey,
  type CommunityObservation,
  type Dataset,
  type IdentityLink,
  type ProductionRun,
  type Proposal,
  type Vote,
} from './types.js';

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A simulator dataset, or a production run export converted into one. */
export function parseDataset(input: unknown): Dataset {
  const root = record(input, 'dataset');
  if ('runId' in root && 'dataset' in root && 'params' in root) return fromRunExport(root);
  if (root.version !== DATASET_VERSION) {
    throw new DatasetError(
      root.delegates !== undefined
        ? 'This dataset was collected by the old simulator collector, before production existed. ' +
            'Re-import from production with `npm run import`.'
        : `Not a simulator dataset (version ${DATASET_VERSION}) or a production run export. ` +
            'A parameter or delegation preset is imported from the sidebar instead.',
    );
  }
  const roster = array(root.roster, 'roster').map(candidate);
  if (roster.length === 0) throw new DatasetError('roster: empty — nothing to score.');
  const range = record(root.dateRange, 'dateRange');
  const start = isoDate(range.start, 'dateRange.start');
  const end = isoDate(range.end, 'dateRange.end');
  if (start > end) throw new DatasetError(`dateRange runs backwards: ${start} is after ${end}.`);
  return {
    version: DATASET_VERSION,
    generatedAt: str(root.generatedAt, 'generatedAt'),
    origin: str(root.origin, 'origin'),
    space: str(root.space, 'space'),
    dateRange: { start, end },
    roster,
    proposals: array(root.proposals, 'proposals').map(proposal),
    votes: array(root.votes, 'votes').map(vote),
    community: array(root.community, 'community').map(observation),
    balanceDates: array(root.balanceDates, 'balanceDates').map((d, i) => isoDate(d, `balanceDates[${i}]`)),
    balances: array(root.balances, 'balances').map(series),
    identities: array(root.identities, 'identities').map(identityLink),
    nominations: parseNominations(array(root.nominations, 'nominations')),
    ethCommunity: addresses(root.ethCommunity, 'ethCommunity'),
    optedOut: addresses(root.optedOut, 'optedOut'),
    safeDelegators: addresses(root.safeDelegators, 'safeDelegators'),
    pools: array(root.pools, 'pools').map((v, i) => {
      const r = record(v, `pools[${i}]`);
      return { asOf: isoDate(r.asOf, `pools[${i}].asOf`), pool: num(r.pool, `pools[${i}].pool`) };
    }),
    production: root.production === null ? null : productionRun(root.production),
  };
}

/**
 * A production run export: the run's frozen Dataset and config. Scores exactly
 * that one as-of — a frozen Dataset holds only the latest HighSignal
 * observation and the balances its holdings window needs, so earlier as-ofs
 * would be scored on data production did not use.
 */
export function fromRunExport(root: Record<string, unknown>): Dataset {
  const runId = num(root.runId, 'runId');
  const asOf = isoDate(root.asOf, 'asOf');
  const frozen = record(root.dataset, 'dataset');
  const delegation = record(root.delegation, 'delegation');
  const balanceRows = array(frozen.balances, 'dataset.balances').map((v, i) => {
    const r = record(v, `dataset.balances[${i}]`);
    return {
      address: address(r.address, `dataset.balances[${i}].address`),
      date: isoDate(r.date, `dataset.balances[${i}].date`),
      total: decimalSumToNumber(
        str(r.ssv, `dataset.balances[${i}].ssv`),
        str(r.cssv, `dataset.balances[${i}].cssv`),
      ),
    };
  });
  return {
    version: DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    origin: `production run ${runId} export`,
    space: 'mainnet.ssvnetwork.eth',
    dateRange: { start: asOf, end: asOf },
    roster: array(frozen.roster, 'dataset.roster').map((v, i) => {
      const r = record(v, `dataset.roster[${i}]`);
      return {
        address: address(r.address, `dataset.roster[${i}].address`),
        displayName: str(r.displayName, `dataset.roster[${i}].displayName`),
        sources: [],
        forumHandle: null,
        discordHandle: null,
        ensName: null,
      };
    }),
    proposals: array(frozen.proposals, 'dataset.proposals').map(proposal),
    votes: array(frozen.votes, 'dataset.votes').map(vote),
    community: array(frozen.community, 'dataset.community').map(observation),
    balanceDates: [...new Set(balanceRows.map((b) => b.date))].sort(cmp),
    balances: toChangePoints(balanceRows),
    identities: array(frozen.identities, 'dataset.identities').map(identityLink),
    nominations: parseNominations(array(frozen.nominations, 'dataset.nominations')),
    ethCommunity: addresses(frozen.ethCommunity, 'dataset.ethCommunity'),
    optedOut: addresses(frozen.optedOut, 'dataset.optedOut'),
    safeDelegators: addresses(frozen.safeDelegators, 'dataset.safeDelegators'),
    pools: [{ asOf, pool: Number(str(frozen.pool, 'dataset.pool')) }],
    production: {
      runId,
      asOf,
      codeVersion: str(root.codeVersion, 'codeVersion'),
      params: parseParams(root.params),
      delegation: parseDelegation(delegation),
      rows: [],
    },
  };
}

/** Daily balance rows → per-address change points (see `BalanceSeries`). */
export function toChangePoints(
  rows: ReadonlyArray<{ address: string; date: string; total: number }>,
): BalanceSeries[] {
  const byAddress = new Map<string, Array<{ date: string; total: number }>>();
  for (const r of rows) {
    const list = byAddress.get(r.address) ?? [];
    list.push(r);
    byAddress.set(r.address, list);
  }
  return [...byAddress].map(([addr, list]) => {
    list.sort((a, b) => cmp(a.date, b.date));
    const changes: Array<[string, number]> = [];
    for (const r of list) {
      const last = changes.at(-1);
      if (!last || !Object.is(last[1], r.total)) changes.push([r.date, r.total]);
    }
    return { address: addr, changes };
  });
}

export function describeDataset(d: Dataset): string {
  return (
    `${d.roster.length} candidates · ${d.proposals.length} proposals · ` +
    `${d.balanceDates.length} balance days · ${d.dateRange.start} → ${d.dateRange.end}`
  );
}

// --- Row parsers -------------------------------------------------------------

const candidate = (v: unknown, i: number): Candidate => {
  const r = record(v, `roster[${i}]`);
  return {
    address: address(r.address, `roster[${i}].address`),
    displayName: str(r.displayName, `roster[${i}].displayName`),
    sources: array(r.sources, `roster[${i}].sources`).map((s, j) => str(s, `roster[${i}].sources[${j}]`)),
    forumHandle: optStr(r.forumHandle),
    discordHandle: optStr(r.discordHandle),
    ensName: optStr(r.ensName),
  };
};

const proposal = (v: unknown, i: number): Proposal => {
  const r = record(v, `proposals[${i}]`);
  return {
    id: str(r.id, `proposals[${i}].id`),
    title: typeof r.title === 'string' ? r.title : '',
    end: num(r.end, `proposals[${i}].end`),
  };
};

const vote = (v: unknown, i: number): Vote => {
  const r = record(v, `votes[${i}]`);
  return {
    proposalId: str(r.proposalId, `votes[${i}].proposalId`),
    voter: address(r.voter, `votes[${i}].voter`),
    created: num(r.created, `votes[${i}].created`),
  };
};

const observation = (v: unknown, i: number): CommunityObservation => {
  const r = record(v, `community[${i}]`);
  return {
    address: address(r.address, `community[${i}].address`),
    date: isoDate(r.date, `community[${i}].date`),
    score: num(r.score, `community[${i}].score`),
    hsUsername: optStr(r.hsUsername),
    hsRank: typeof r.hsRank === 'number' ? r.hsRank : null,
  };
};

const series = (v: unknown, i: number): BalanceSeries => {
  const r = record(v, `balances[${i}]`);
  return {
    address: address(r.address, `balances[${i}].address`),
    changes: array(r.changes, `balances[${i}].changes`).map((c, j) => {
      if (!Array.isArray(c) || c.length !== 2) {
        throw new DatasetError(`balances[${i}].changes[${j}]: expected [date, amount].`);
      }
      return [isoDate(c[0], `balances[${i}].changes[${j}][0]`), num(c[1], `balances[${i}].changes[${j}][1]`)];
    }),
  };
};

const identityLink = (v: unknown, i: number): IdentityLink => {
  const r = record(v, `identities[${i}]`);
  return {
    address: address(r.address, `identities[${i}].address`),
    hsUsername: str(r.hsUsername, `identities[${i}].hsUsername`),
  };
};

const COHORTS: readonly string[] = [
  'ssvCommunity',
  'verifiedOperators',
  'professional',
  'grantRecipients',
  'ethCommunities',
];

function productionRun(v: unknown): ProductionRun {
  const r = record(v, 'production');
  return {
    runId: num(r.runId, 'production.runId'),
    asOf: isoDate(r.asOf, 'production.asOf'),
    codeVersion: str(r.codeVersion, 'production.codeVersion'),
    params: parseParams(r.params),
    delegation: parseDelegation(r.delegation),
    rows: array(r.rows, 'production.rows').map((row, i) => {
      const x = record(row, `production.rows[${i}]`);
      const cohort = x.cohort === null || COHORTS.includes(x.cohort as string) ? x.cohort : undefined;
      if (cohort === undefined) throw new DatasetError(`production.rows[${i}].cohort: unknown cohort.`);
      return {
        address: address(x.address, `production.rows[${i}].address`),
        rank: x.rank === null ? null : num(x.rank, `production.rows[${i}].rank`),
        score: x.score === null ? null : num(x.score, `production.rows[${i}].score`),
        cohort: cohort as CohortKey | null,
        power: num(x.power, `production.rows[${i}].power`),
      };
    }),
  };
}

// --- Primitives --------------------------------------------------------------

function record(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new DatasetError(`${field}: expected an object, got ${describe(v)}.`);
  }
  return v as Record<string, unknown>;
}

function array(v: unknown, field: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new DatasetError(`${field}: expected an array, got ${describe(v)}.`);
  return v;
}

function str(v: unknown, field: string): string {
  if (typeof v === 'string' && v !== '') return v;
  throw new DatasetError(`${field}: expected a non-empty string, got ${describe(v)}.`);
}

const optStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new DatasetError(`${field}: expected a number, got ${describe(v)}.`);
  }
  return v;
}

function address(v: unknown, field: string): string {
  const s = str(v, field);
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) throw new DatasetError(`${field}: not an address: "${s}".`);
  return s.toLowerCase();
}

function addresses(v: unknown, field: string): string[] {
  return array(v, field).map((a, i) => address(a, `${field}[${i}]`));
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
