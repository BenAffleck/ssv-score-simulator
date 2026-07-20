/** Delegate roster from data/delegates.csv (address, forumHandle, discordUsername, displayName). */
import { existsSync, readFileSync } from 'node:fs';
import type { DelegateRow } from '../scoring-core/types.js';
import { parseCsv } from './util.js';

export function loadDelegates(csvPath: string): DelegateRow[] {
  if (!existsSync(csvPath)) {
    throw new Error(
      `Delegate roster not found: ${csvPath}\n` +
        '  → Provide data/delegates.csv with columns: address,forumHandle,discordUsername,displayName',
    );
  }

  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const delegates: DelegateRow[] = [];
  const seen = new Set<string>();

  for (const [i, r] of rows.entries()) {
    const address = (r.address ?? '').trim();
    if (!address) continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error(`delegates.csv row ${i + 2}: "${address}" is not a valid Ethereum address.`);
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    delegates.push({
      address: key,
      forumHandle: r.forumHandle ?? '',
      discordUsername: r.discordUsername ?? '',
      displayName: r.displayName || r.forumHandle || key,
    });
  }

  if (delegates.length === 0) {
    throw new Error(`No delegates found in ${csvPath} — the roster is empty.`);
  }
  return delegates;
}
