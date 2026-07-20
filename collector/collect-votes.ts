/**
 * Snapshot vote history via the public GraphQL API (no key required).
 * Stores every closed proposal in the space plus a (delegate, proposal, voted)
 * row for each delegate.
 */
import { pathToFileURL } from 'node:url';
import { DELEGATES_CSV, SNAPSHOT_API, SNAPSHOT_SPACE, SQLITE_PATH } from '../config.js';
import type { DelegateRow, ProposalRow, VoteRow } from '../scoring-core/types.js';
import { openDb, upsertDelegates, upsertProposals, upsertVotes, type DB } from './db.js';
import { loadDelegates } from './delegates.js';
import { chunk, log, withRetry } from './util.js';

const PAGE = 1_000;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  return withRetry('snapshot graphql', async () => {
    const res = await fetch(SNAPSHOT_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from ${SNAPSHOT_API}`);

    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) throw new Error(`Snapshot GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
    if (!body.data) throw new Error('Snapshot GraphQL returned no data.');
    return body.data;
  });
}

const PROPOSALS_QUERY = `
  query Proposals($space: String!, $first: Int!, $skip: Int!) {
    proposals(
      first: $first, skip: $skip,
      where: { space: $space, state: "closed" },
      orderBy: "end", orderDirection: desc
    ) { id title end }
  }
`;

const VOTES_QUERY = `
  query Votes($space: String!, $voters: [String!], $first: Int!, $skip: Int!) {
    votes(
      first: $first, skip: $skip,
      where: { space: $space, voter_in: $voters }
    ) { voter proposal { id } }
  }
`;

export async function fetchClosedProposals(space = SNAPSHOT_SPACE): Promise<ProposalRow[]> {
  const out: ProposalRow[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const data = await gql<{ proposals: Array<{ id: string; title: string; end: number }> }>(
      PROPOSALS_QUERY,
      { space, first: PAGE, skip },
    );
    const batch = data.proposals ?? [];
    out.push(...batch.map((p) => ({ id: p.id, title: p.title ?? '', endTs: Number(p.end) })));
    if (batch.length < PAGE) break;
    // Snapshot caps skip at 5000 on some deployments; stop before erroring out.
    if (skip + PAGE >= 5_000) break;
  }
  log('votes', `fetched ${out.length} closed proposal(s) from ${space}`);
  return out;
}

/** Proposal ids each delegate voted on. */
export async function fetchVotesByDelegate(
  addresses: string[],
  space = SNAPSHOT_SPACE,
): Promise<Map<string, Set<string>>> {
  const byVoter = new Map<string, Set<string>>();

  // Chunk the voter list so the `voter_in` filter stays within query limits.
  for (const voters of chunk(addresses.map((a) => a.toLowerCase()), 20)) {
    for (let skip = 0; ; skip += PAGE) {
      const data = await gql<{ votes: Array<{ voter: string; proposal: { id: string } | null }> }>(
        VOTES_QUERY,
        { space, voters, first: PAGE, skip },
      );
      const batch = data.votes ?? [];
      for (const v of batch) {
        if (!v.proposal?.id) continue;
        const key = v.voter.toLowerCase();
        const set = byVoter.get(key) ?? new Set<string>();
        set.add(v.proposal.id);
        byVoter.set(key, set);
      }
      if (batch.length < PAGE) break;
      if (skip + PAGE >= 5_000) break;
    }
  }

  return byVoter;
}

export async function collectVotes(db: DB, delegates: DelegateRow[], space = SNAPSHOT_SPACE): Promise<void> {
  const proposals = await fetchClosedProposals(space);
  upsertProposals(db, proposals);

  const addresses = delegates.map((d) => d.address.toLowerCase());
  const byVoter = await fetchVotesByDelegate(addresses, space);

  const rows: VoteRow[] = [];
  for (const address of addresses) {
    const voted = byVoter.get(address) ?? new Set<string>();
    for (const p of proposals) {
      rows.push({ address, proposalId: p.id, voted: voted.has(p.id) ? 1 : 0 });
    }
  }
  upsertVotes(db, rows);

  const participants = [...byVoter.values()].filter((s) => s.size > 0).length;
  log('votes', `wrote ${rows.length} vote row(s); ${participants}/${addresses.length} delegate(s) have voted at least once`);
}

async function main(): Promise<void> {
  const delegates = loadDelegates(DELEGATES_CSV);
  const db = openDb(SQLITE_PATH);
  upsertDelegates(db, delegates);
  await collectVotes(db, delegates);
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
