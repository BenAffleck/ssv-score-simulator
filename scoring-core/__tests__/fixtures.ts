/** Dataset builders for tests, mirroring production's test helpers. */
import { addDays, DAY_SECONDS, endOfDay } from '../dates.js';
import { toChangePoints } from '../dataset-io.js';
import { DEFAULT_PARAMS, cloneParams } from '../params.js';
import { prepare, type Prepared } from '../prepared.js';
import { evaluate } from '../score.js';
import {
  DATASET_VERSION,
  type CommunityObservation,
  type Dataset,
  type IdentityLink,
  type Params,
  type Proposal,
  type Row,
  type Vote,
} from '../types.js';

export const AS_OF = '2026-06-30';
export const ALICE = '0x00000000000000000000000000000000000000a1';
export const BOB = '0x00000000000000000000000000000000000000b0';
export const CAROL = '0x00000000000000000000000000000000000000c0';
export const CAROL_HOT = '0x00000000000000000000000000000000000000c1';
export const DAVE = '0x00000000000000000000000000000000000000d0';
export const WHALE = '0x00000000000000000000000000000000000000ff';

export interface BalanceRow {
  address: string;
  date: string;
  total: number;
}

/** `days` daily balance rows of `amount`, ending on `last`. */
export function held(address: string, amount: number, days: number, last = AS_OF): BalanceRow[] {
  return Array.from({ length: days }, (_, i) => ({ address, date: addDays(last, -i), total: amount }));
}

export function dataset(parts: {
  roster: string[];
  balances?: BalanceRow[];
  proposals?: Proposal[];
  votes?: Vote[];
  community?: CommunityObservation[];
  identities?: IdentityLink[];
}): Dataset {
  const balances = parts.balances ?? [];
  return {
    version: DATASET_VERSION,
    generatedAt: '2026-07-01T00:00:00.000Z',
    origin: 'test',
    space: 'test',
    dateRange: { start: AS_OF, end: AS_OF },
    roster: parts.roster.map((address) => ({
      address,
      displayName: address,
      sources: [],
      forumHandle: null,
      discordHandle: null,
      ensName: null,
    })),
    proposals: parts.proposals ?? [],
    votes: parts.votes ?? [],
    community: parts.community ?? [],
    balanceDates: [...new Set(balances.map((b) => b.date))].sort(),
    balances: toChangePoints(balances),
    identities: parts.identities ?? [],
    nominations: [],
    ethCommunity: [],
    optedOut: [],
    safeDelegators: [],
    pools: [],
    production: null,
  };
}

export function params(patch: (p: Params) => void = () => {}): Params {
  const p = cloneParams(DEFAULT_PARAMS);
  patch(p);
  return p;
}

export function score(d: Dataset | Prepared, p: Params = params(), asOf = AS_OF): Row[] {
  return evaluate('dataset' in d ? d : prepare(d), p, asOf);
}

export function row(rows: Row[], address: string): Row {
  const found = rows.find((r) => r.address === address);
  if (!found) throw new Error(`no row for ${address}`);
  return found;
}

/** `count` proposals `spacingDays` apart, the newest closing an hour before the as-of ends. */
export function proposals(count: number, spacingDays = 30, asOf = AS_OF): Proposal[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    title: `P${i}`,
    end: endOfDay(asOf) - 3600 - i * spacingDays * DAY_SECONDS,
  }));
}

/** `voter` voted on each of `on`, just before it closed. */
export function voted(voter: string, on: Proposal[]): Vote[] {
  return on.map((p) => ({ proposalId: p.id, voter, created: p.end - 1 }));
}

export function observed(address: string, score: number, date = AS_OF): CommunityObservation {
  return { address, date, score, hsUsername: null, hsRank: null };
}
