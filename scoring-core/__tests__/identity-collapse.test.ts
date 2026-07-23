/**
 * A person may hold several eth addresses, published on HighSignal. They must
 * collapse to a single canonical delegate (the first that appears in the
 * roster) so an identity is represented — and delegated to — exactly once.
 */
import { describe, expect, it } from 'vitest';
import { indexDataset, simulate } from '../simulate.js';
import { DEFAULT_PARAMS } from '../params.js';
import type { Dataset } from '../types.js';

function dataset(identities: Dataset['identities']): Dataset {
  return {
    generatedAt: '2026-07-23T00:00:00.000Z',
    space: 'test',
    dateRange: { start: '2026-07-01', end: '2026-07-02' },
    delegates: [
      { address: '0xAAA', forumHandle: '', discordUsername: '', displayName: 'eridian' }, // first → canonical
      { address: '0xBBB', forumHandle: '', discordUsername: '', displayName: 'eridian-alt' },
      { address: '0xCCC', forumHandle: '', discordUsername: '', displayName: 'solo' },
    ],
    balances: [],
    proposals: [],
    votes: [],
    highsignal: [],
    identities,
  };
}

const addresses = (d: Dataset) =>
  simulate(indexDataset(d), DEFAULT_PARAMS, '2026-07-02').map((r) => r.address.toLowerCase());

describe('identity collapse', () => {
  it('keeps the first-appearing roster address and drops the alias', () => {
    const d = dataset([{ address: '0xaaa', hsUsername: 'eridian', linkedAddresses: ['0xbbb'] }]);
    const rows = addresses(d);
    expect(rows).toContain('0xaaa');
    expect(rows).not.toContain('0xbbb'); // alias collapsed away
    expect(rows).toContain('0xccc');
    expect(rows).toHaveLength(2);
  });

  it('is symmetric no matter which linked row is present', () => {
    const d = dataset([{ address: '0xbbb', hsUsername: 'eridian', linkedAddresses: ['0xaaa'] }]);
    const rows = addresses(d);
    expect(rows).toContain('0xaaa'); // 0xAAA still wins — it appears first in the roster
    expect(rows).not.toContain('0xbbb');
  });

  it('leaves everyone in place when there are no identities', () => {
    expect(addresses(dataset([]))).toHaveLength(3);
  });
});
