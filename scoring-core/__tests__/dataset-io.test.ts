/**
 * A dataset that arrives by hand is untrusted input. These pin the failures
 * that would otherwise surface as a confidently-wrong leaderboard rather than
 * as an import error.
 */
import { describe, expect, it } from 'vitest';
import { DatasetError, describeDataset, parseDataset } from '../dataset-io.js';
import { indexDataset, simulate } from '../simulate.js';
import { DEFAULT_PARAMS } from '../params.js';
import type { Dataset } from '../types.js';

const valid: Dataset = {
  generatedAt: '2026-07-20T12:49:08.269Z',
  space: 'mainnet.ssvnetwork.eth',
  dateRange: { start: '2026-07-01', end: '2026-07-02' },
  delegates: [
    { address: '0xaaa', forumHandle: 'a', discordUsername: 'a#0', displayName: 'Alice' },
  ],
  balances: [
    { address: '0xaaa', date: '2026-07-01', ssvErc20: 100, cssv: 5 },
    { address: '0xaaa', date: '2026-07-02', ssvErc20: 110, cssv: 5 },
  ],
  proposals: [{ id: 'p1', title: 'One', endTs: 1_780_000_000 }],
  votes: [{ address: '0xaaa', proposalId: 'p1', voted: 1 }],
  highsignal: [
    { address: '0xaaa', date: '2026-07-01', score: 82, hsUsername: 'alice', hsRank: 3 },
  ],
  ethCommunities: [{ address: '0xccc', project: 'other', hsUsername: 'carol' }],
  identities: [{ address: '0xaaa', hsUsername: 'alice', linkedAddresses: ['0xa11', '0xa12'] }],
};

const clone = (): any => JSON.parse(JSON.stringify(valid));

describe('parseDataset — round trip', () => {
  it('accepts what the collector writes, unchanged', () => {
    expect(parseDataset(clone())).toEqual(valid);
  });

  it('survives JSON.stringify → parse and still scores identically', () => {
    const reparsed = parseDataset(JSON.parse(JSON.stringify(valid)));
    const before = simulate(indexDataset(valid), DEFAULT_PARAMS, '2026-07-02');
    const after = simulate(indexDataset(reparsed), DEFAULT_PARAMS, '2026-07-02');
    expect(after).toEqual(before);
  });

  it('leaves address casing alone — indexDataset lowercases at lookup', () => {
    const d = clone();
    d.delegates[0].address = '0xAAA';
    expect(parseDataset(d).delegates[0]!.address).toBe('0xAAA');
  });

  it('treats absent optional sources as empty, not as an error', () => {
    const d = clone();
    delete d.highsignal;
    delete d.votes;
    delete d.ethCommunities;
    delete d.identities;
    expect(parseDataset(d).highsignal).toEqual([]);
    expect(parseDataset(d).votes).toEqual([]);
    expect(parseDataset(d).ethCommunities).toEqual([]);
    expect(parseDataset(d).identities).toEqual([]);
  });

  it('parses identity rows (linked eth addresses per delegate)', () => {
    const d = clone();
    d.identities = [{ address: '0xAAA', hsUsername: 'alice', linkedAddresses: ['0xB', '0xC'] }];
    const parsed = parseDataset(d).identities!;
    expect(parsed).toEqual([{ address: '0xAAA', hsUsername: 'alice', linkedAddresses: ['0xB', '0xC'] }]);
  });

  it('parses ethCommunities rows when present (delegation impact cohort)', () => {
    const d = clone();
    d.ethCommunities = [
      { address: '0xDDD', project: 'foo', hsUsername: 'dave' },
      { address: '0xeee', project: 'bar' }, // hsUsername omitted → null
    ];
    const parsed = parseDataset(d).ethCommunities!;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ address: '0xDDD', project: 'foo', hsUsername: 'dave' });
    expect(parsed[1]!.hsUsername).toBeNull();
  });
});

describe('parseDataset — rejections', () => {
  it('rejects a parameter preset, the likeliest wrong file', () => {
    const preset = { version: 1, name: 'custom', params: DEFAULT_PARAMS };
    expect(() => parseDataset(preset)).toThrow(/no "delegates" array/);
  });

  it('rejects an empty roster rather than rendering an empty board', () => {
    const d = clone();
    d.delegates = [];
    expect(() => parseDataset(d)).toThrow(/no delegates/);
  });

  it('names the exact row and field on a malformed balance', () => {
    const d = clone();
    d.balances[1].ssvErc20 = 'not-a-number';
    expect(() => parseDataset(d)).toThrow(/balances\[1\]\.ssvErc20/);
  });

  it('rejects a non-ISO date instead of letting string comparison misorder it', () => {
    const d = clone();
    d.balances[0].date = '07/01/2026';
    expect(() => parseDataset(d)).toThrow(/expected YYYY-MM-DD/);
  });

  it('rejects a backwards dateRange', () => {
    const d = clone();
    d.dateRange = { start: '2026-07-02', end: '2026-07-01' };
    expect(() => parseDataset(d)).toThrow(/runs backwards/);
  });

  it('throws DatasetError, so the UI can show the message verbatim', () => {
    expect(() => parseDataset(null)).toThrow(DatasetError);
    expect(() => parseDataset('[]')).toThrow(DatasetError);
  });
});

describe('describeDataset', () => {
  it('summarises what was imported', () => {
    expect(describeDataset(valid)).toBe(
      '1 delegates · 2 balance rows · 1 proposals · 2026-07-01 → 2026-07-02',
    );
  });
});
