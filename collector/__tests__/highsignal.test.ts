/**
 * HighSignal matching, pinned to the LIVE API schema.
 *
 * The spec described `addresses[]`; the API actually returns
 * `ethereumAddresses[]`, and only for users who shared them with the project
 * on an authenticated request. Reading the wrong field matches nobody and
 * fails silently, so it is locked down here.
 */
import { describe, expect, it } from 'vitest';
import { addressesOf, type HighSignalUser } from '../highsignal/types.js';
import { CsvHighSignalProvider } from '../highsignal/csv.js';
import { HIGHSIGNAL_CSV } from '../../config.js';

const TARGET = '0x2de670a1D8c1DE83D8727295284704bB196bA117';

/** Shape copied from a real /api/users response. */
const realRecord: HighSignalUser = {
  username: 'benaffleck',
  displayName: 'BenAffleck',
  rank: 56,
  score: 8,
  ethereumAddresses: [TARGET],
  historicalScores: [
    { day: '2026-07-19', totalScore: 7 },
    { day: '2026-07-18', totalScore: 6 },
  ],
};

describe('address extraction', () => {
  it('reads ethereumAddresses — the field the API actually returns', () => {
    expect(addressesOf(realRecord)).toEqual([TARGET.toLowerCase()]);
  });

  it('lowercases so checksummed API values match lowercase roster entries', () => {
    // The API returns EIP-55 checksummed; delegates.csv is lowercase.
    expect(addressesOf(realRecord)[0]).toBe(TARGET.toLowerCase());
    expect(addressesOf(realRecord)[0]).not.toBe(TARGET);
  });

  it('still tolerates the spec-documented addresses[] spelling', () => {
    const legacy = { ...realRecord, ethereumAddresses: undefined, addresses: [TARGET] };
    expect(addressesOf(legacy)).toEqual([TARGET.toLowerCase()]);
  });

  it('returns nothing for a record with no addresses (unauthenticated response)', () => {
    const stripped = { ...realRecord, ethereumAddresses: undefined, addresses: undefined };
    expect(addressesOf(stripped)).toEqual([]);
  });

  it('ignores malformed entries rather than throwing', () => {
    const messy = { ...realRecord, ethereumAddresses: ['', null as unknown as string, TARGET] };
    expect(addressesOf(messy)).toEqual([TARGET.toLowerCase()]);
  });
});

describe('CSV provider still works offline', () => {
  it('reads dated rows from data/highsignal.csv', async () => {
    const provider = new CsvHighSignalProvider(HIGHSIGNAL_CSV);
    const rows = await provider.fetchScores(
      ['0x1111111111111111111111111111111111111111'],
      '2026-07-20',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.address === '0x1111111111111111111111111111111111111111')).toBe(true);
    expect(rows.every((r) => Number.isFinite(r.score))).toBe(true);
  });

  it('omits delegates with no CSV entry — community stays null, not zero', async () => {
    const provider = new CsvHighSignalProvider(HIGHSIGNAL_CSV);
    const rows = await provider.fetchScores(['0x9999999999999999999999999999999999999999'], '2026-07-20');
    expect(rows).toEqual([]);
  });
});
