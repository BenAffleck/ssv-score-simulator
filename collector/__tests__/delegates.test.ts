/**
 * The delegate roster is an EXTERNAL input (SPEC §3.3): generated upstream,
 * outside this pipeline, and expected to be regenerated as its production
 * evolves. These tests pin the input contract so an upstream change that
 * breaks it fails loudly here rather than silently dropping delegates.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDelegates } from '../delegates.js';

const dir = mkdtempSync(join(tmpdir(), 'roster-'));
let seq = 0;

function roster(csv: string): string {
  const path = join(dir, `roster-${seq++}.csv`);
  writeFileSync(path, csv);
  return path;
}

const A = '0x2de670a1d8c1de83d8727295284704bb196ba117';
const B = '0x9933fcd422180fe81c83aed0de219c6fc4a08c15';
const HEADER = 'address,forumHandle,discordUsername,displayName';

describe('roster input contract', () => {
  it('reads the four documented columns', () => {
    const [d] = loadDelegates(roster(`${HEADER}\n${A},alice,alice#0,Alice\n`));
    expect(d).toEqual({
      address: A,
      forumHandle: 'alice',
      discordUsername: 'alice#0',
      displayName: 'Alice',
    });
  });

  it('accepts quoted fields, as exported by typical generators', () => {
    const [d] = loadDelegates(roster(`${HEADER}\n"${A}","alice","alice#0","LinkoPlus | AXBLOX"\n`));
    expect(d!.displayName).toBe('LinkoPlus | AXBLOX');
  });

  it('lowercases addresses so checksummed input still joins', () => {
    const checksummed = '0x2de670a1D8c1DE83D8727295284704bB196bA117';
    expect(loadDelegates(roster(`${HEADER}\n${checksummed},,,X\n`))[0]!.address).toBe(A);
  });

  it('permits empty optional fields without dropping the row', () => {
    const rows = loadDelegates(roster(`${HEADER}\n${A},,,\n${B},,,\n`));
    expect(rows).toHaveLength(2);
  });

  it('falls back displayName → forumHandle → address', () => {
    const rows = loadDelegates(roster(`${HEADER}\n${A},handle,,\n${B},,,\n`));
    expect(rows[0]!.displayName).toBe('handle');
    expect(rows[1]!.displayName).toBe(B);
  });

  it('collapses duplicate addresses to the first occurrence', () => {
    const rows = loadDelegates(roster(`${HEADER}\n${A},first,,First\n${A},second,,Second\n`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe('First');
  });

  it('tolerates a missing trailing newline', () => {
    expect(loadDelegates(roster(`${HEADER}\n${A},a,,A`))).toHaveLength(1);
  });

  it('ignores unknown columns, so the contract can grow', () => {
    // An upstream generator adding a column must not break existing consumers.
    const csv = `${HEADER},highSignalUsername,tier\n${A},alice,alice#0,Alice,alice-hs,gold\n`;
    const [d] = loadDelegates(roster(csv));
    expect(d!.displayName).toBe('Alice');
    expect(d).not.toHaveProperty('tier');
  });
});

describe('roster failures are loud, never silent', () => {
  it('rejects a malformed address, naming the row', () => {
    const csv = `${HEADER}\n${A},a,,A\nnot-an-address,b,,B\n`;
    expect(() => loadDelegates(roster(csv))).toThrow(/row 3/);
  });

  it('rejects a truncated address rather than scoring the wrong account', () => {
    expect(() => loadDelegates(roster(`${HEADER}\n0x2de670a1,a,,A\n`))).toThrow(/not a valid/i);
  });

  it('rejects an empty roster', () => {
    expect(() => loadDelegates(roster(`${HEADER}\n`))).toThrow(/empty/i);
  });

  it('reports a missing file with the path', () => {
    expect(() => loadDelegates(join(dir, 'does-not-exist.csv'))).toThrow(/not found/i);
  });
});
