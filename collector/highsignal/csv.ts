/**
 * Offline HighSignal provider — reads `data/highsignal.csv` (`address,date,score`,
 * optional `username,rank`). Lets the collector and the UI run with no API key,
 * and lets a historical community series be backfilled by hand.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { HighSignalRow } from '../../scoring-core/types.js';
import { log, parseCsv } from '../util.js';
import type { HighSignalProvider } from './types.js';

export class CsvHighSignalProvider implements HighSignalProvider {
  readonly name = 'highsignal:csv';

  constructor(private readonly path: string) {}

  async fetchScores(addresses: string[], collectionDate: string): Promise<HighSignalRow[]> {
    if (!existsSync(this.path)) {
      throw new Error(
        `HighSignal CSV not found: ${this.path}\n` +
          '  → Expected columns: address,date,score[,username,rank]\n' +
          '  → Or unset HIGHSIGNAL_SOURCE=csv to use the live API instead.',
      );
    }

    const wanted = new Set(addresses.map((a) => a.toLowerCase()));
    const rows: HighSignalRow[] = [];
    const seen = new Set<string>();

    for (const [i, r] of parseCsv(readFileSync(this.path, 'utf8')).entries()) {
      const address = (r.address ?? '').trim().toLowerCase();
      if (!address || !wanted.has(address)) continue;

      const score = Number(r.score);
      if (!Number.isFinite(score)) {
        throw new Error(`highsignal.csv row ${i + 2}: score "${r.score}" is not a number.`);
      }

      const date = (r.date ?? '').trim() || collectionDate;
      const key = `${address}|${date}`;
      if (seen.has(key)) continue; // (address,date) is the primary key
      seen.add(key);

      rows.push({
        address,
        date,
        score,
        hsUsername: r.username || null,
        hsRank: Number.isFinite(Number(r.rank)) && r.rank ? Number(r.rank) : null,
      });
    }

    log('highsignal', `loaded ${rows.length} rows from ${this.path} (offline CSV adapter)`);
    return rows;
  }
}
