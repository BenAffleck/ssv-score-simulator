/**
 * Live HighSignal provider — pages through
 * `https://app.highsignal.xyz/api/users?apiKey=…&project=ssv&page=N`
 * and matches each delegate to the user whose `addresses[]` contains it.
 *
 * HighSignal exposes only *current* scores, so each run appends one dated row
 * per delegate and the community series accrues forward from the first run.
 */
import { HIGHSIGNAL_API, HIGHSIGNAL_PROJECT, requireHighSignalApiKey } from '../../config.js';
import type { HighSignalRow } from '../../scoring-core/types.js';
import { fetchJson, log, redact, withRetry } from '../util.js';
import { addressesOf, type HighSignalPage, type HighSignalProvider, type HighSignalUser } from './types.js';

const MAX_PAGES = 200; // hard stop; guards against a runaway maxPage

export class HttpHighSignalProvider implements HighSignalProvider {
  readonly name = 'highsignal:http';

  constructor(private readonly apiKey: string = requireHighSignalApiKey()) {}

  async fetchScores(addresses: string[], collectionDate: string): Promise<HighSignalRow[]> {
    const users = await this.fetchAllUsers();

    // address (lowercased) → user
    const byAddress = new Map<string, HighSignalUser>();
    let usersWithAddresses = 0;
    for (const u of users) {
      const addrs = addressesOf(u);
      if (addrs.length > 0) usersWithAddresses++;
      for (const a of addrs) byAddress.set(a, u);
    }

    const rows: HighSignalRow[] = [];
    let matched = 0;
    let historyDays = 0;

    for (const address of addresses) {
      const key = address.toLowerCase();
      const user = byAddress.get(key);
      if (!user) continue;
      matched++;

      const meta = {
        hsUsername: user.username ?? null,
        hsRank: Number.isFinite(user.rank) ? user.rank : null,
      };

      // Backfill the real daily series when the record carries one. This is
      // the whole community time series, not just today's reading.
      for (const point of user.historicalScores ?? []) {
        if (!point?.day || !Number.isFinite(point.totalScore)) continue;
        if (point.day > collectionDate) continue; // never record the future
        historyDays++;
        rows.push({ address: key, date: point.day, score: Number(point.totalScore), ...meta });
      }

      // `score` is the authoritative current value; write it last so it wins
      // the (address, date) upsert if the series also covers today.
      rows.push({ address: key, date: collectionDate, score: Number(user.score), ...meta });
    }

    log(
      'highsignal',
      `matched ${matched}/${addresses.length} delegates against ${users.length} users ` +
        `(${usersWithAddresses} expose an address); ${historyDays} historical day(s) backfilled`,
    );

    if (matched === 0 && addresses.length > 0) {
      log('highsignal', 'WARNING: no delegate address matched any HighSignal user.');
      log('highsignal', '  → Addresses are only returned for users who shared them with the project,');
      log('highsignal', '    AND only when the request carries a valid apiKey. Check HIGHSIGNAL_API_KEY.');
    } else if (usersWithAddresses === 0) {
      log('highsignal', 'WARNING: no user in the response exposed an address — is HIGHSIGNAL_API_KEY valid?');
    }

    return rows;
  }

  private async fetchAllUsers(): Promise<HighSignalUser[]> {
    const all: HighSignalUser[] = [];
    let page = 1;
    let maxPage = 1;

    do {
      const url = this.pageUrl(page);
      const body = await withRetry(`highsignal page ${page}`, () => fetchJson<HighSignalPage>(url));

      if (!Array.isArray(body?.data)) {
        throw new Error(`Unexpected HighSignal response from ${redact(url)}: missing "data" array.`);
      }
      all.push(...body.data);

      maxPage = Number.isFinite(body.maxPage) && body.maxPage > 0 ? body.maxPage : page;
      if (page === 1) {
        log('highsignal', `fetching ${body.totalResults ?? '?'} users across ${maxPage} page(s)`);
      }
      page++;
    } while (page <= maxPage && page <= MAX_PAGES);

    return all;
  }

  private pageUrl(page: number): string {
    const params = new URLSearchParams({
      apiKey: this.apiKey,
      project: HIGHSIGNAL_PROJECT,
      page: String(page),
    });
    return `${HIGHSIGNAL_API}?${params.toString()}`;
  }
}
