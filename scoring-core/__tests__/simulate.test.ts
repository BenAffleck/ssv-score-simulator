/** As-of correctness (acceptance §3): only data up to the scrubbed date is used. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../params.js';
import { indexDataset, scoreSeries, simulate } from '../simulate.js';
import type { Dataset } from '../types.js';
import { AS_OF, workedExampleDataset } from './fixtures.js';

const P = DEFAULT_PARAMS;

describe('as-of evaluation', () => {
  it('uses only HighSignal observations recorded on or before the date', () => {
    const ds: Dataset = workedExampleDataset();
    const alice = ds.delegates[0]!.address;
    ds.highsignal = [
      { address: alice, date: '2026-01-15', score: 40, hsUsername: 'alice', hsRank: 20 },
      { address: alice, date: '2026-06-30', score: 82, hsUsername: 'alice', hsRank: 4 },
    ];
    const index = indexDataset(ds);

    const early = simulate(index, P, '2026-03-01').find((r) => r.address === alice)!;
    const late = simulate(index, P, AS_OF).find((r) => r.address === alice)!;

    expect(early.pillars.community).toBe(40); // the June reading must not leak backwards
    expect(late.pillars.community).toBe(82);
  });

  it('reports no community pillar before the first observation', () => {
    const index = indexDataset(workedExampleDataset());
    const row = simulate(index, P, '2025-12-01').find((r) => r.displayName === 'Alice')!;
    expect(row.pillars.community).toBeNull();
    // The score still computes from the remaining pillars.
    expect(row.score).not.toBeNull();
  });

  it('scoreSeries yields one point per date with a score per delegate', () => {
    const index = indexDataset(workedExampleDataset());
    const dates = ['2026-06-28', '2026-06-29', AS_OF];
    const series = scoreSeries(index, P, dates);

    expect(series).toHaveLength(3);
    expect(series[2]!.date).toBe(AS_OF);
    for (const d of index.dataset.delegates) {
      expect(typeof series[2]![d.address.toLowerCase()]).toBe('number');
    }
  });

  it('is address-case insensitive when joining the series', () => {
    const ds = workedExampleDataset();
    ds.balances = ds.balances.map((b) => ({ ...b, address: b.address.toUpperCase() }));
    ds.votes = ds.votes.map((v) => ({ ...v, address: v.address.toLowerCase() }));
    const row = simulate(indexDataset(ds), P, AS_OF).find((r) => r.displayName === 'Alice')!;
    expect(row.raw.twab).toBeCloseTo(2_500, 6);
    expect(row.raw.votedCount).toBe(4);
  });

  it('a delegate absent from every live pillar scores 0, and ranks last', () => {
    const ds = workedExampleDataset();
    ds.delegates.push({
      address: '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc',
      forumHandle: 'ghost',
      discordUsername: 'ghost',
      displayName: 'Ghost',
    });
    // No balances, no votes, no HighSignal. All three pillars are live for the
    // rest of the roster, so Ghost is a per-delegate gap: zeroed, not excluded.
    // Excluding would hand them a score built from nothing and float them up
    // the board.
    const rows = simulate(indexDataset(ds), P, AS_OF);
    const row = rows.find((r) => r.displayName === 'Ghost')!;
    expect(row.pillars).toEqual({ community: 0, holdings: 0, votes: 0 });
    expect(row.missing).toEqual({ community: true, holdings: true, votes: false });
    expect(row.score).toBe(0);
    expect(rows.at(-1)!.displayName).toBe('Ghost');
  });
});
