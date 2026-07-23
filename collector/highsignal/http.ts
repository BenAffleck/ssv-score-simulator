/**
 * Live HighSignal provider — pages through
 * `https://app.highsignal.xyz/api/users?apiKey=…&project=ssv&page=N`
 * and matches each delegate to the user whose `addresses[]` contains it.
 *
 * HighSignal exposes only *current* scores, so each run appends one dated row
 * per delegate and the community series accrues forward from the first run.
 */
import { HIGHSIGNAL_API, HIGHSIGNAL_PROJECT, requireHighSignalApiKey } from '../../config.js';
import type { EthCommunityRow, HighSignalRow, IdentityRow } from '../../scoring-core/types.js';
import { errMessage, fetchJson, log, redact, withRetry } from '../util.js';
import {
  addressesOf,
  signalMeetsThreshold,
  type HighSignalPage,
  type HighSignalProvider,
  type HighSignalUser,
  type SignalTier,
} from './types.js';

const MAX_PAGES = 200; // hard stop; guards against a runaway maxPage

export class HttpHighSignalProvider implements HighSignalProvider {
  readonly name = 'highsignal:http';

  /** Paged once per run for the default project, then reused by scores + identities. */
  private defaultUsers?: Promise<HighSignalUser[]>;

  constructor(private readonly apiKey: string = requireHighSignalApiKey()) {}

  private allUsers(): Promise<HighSignalUser[]> {
    return (this.defaultUsers ??= this.fetchAllUsers());
  }

  async fetchScores(addresses: string[], collectionDate: string): Promise<HighSignalRow[]> {
    const users = await this.allUsers();

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

  /**
   * Deduped published eth addresses of users whose `signal` tier is `minSignal`
   * or higher, across the given other HighSignal projects. Used to seed the
   * Ethereum Communities delegation cohort; the SSV roster is never consulted
   * here.
   */
  async fetchEthCommunityAddresses(projects: string[], minSignal: SignalTier): Promise<EthCommunityRow[]> {
    const rows: EthCommunityRow[] = [];
    const seen = new Set<string>();

    for (const project of projects) {
      // One inaccessible/failed community must not abort the whole cohort —
      // other projects are public and queried keyless, but any that error
      // (e.g. a non-public project that 401s) are skipped with a warning.
      let users;
      try {
        users = await this.fetchAllUsers(project);
      } catch (err) {
        log('highsignal', `project "${project}": skipped — ${errMessage(err)}`);
        continue;
      }
      let contributed = 0;
      let belowSignal = 0;
      for (const u of users) {
        // Only users at the configured signal tier or higher receive delegated
        // voting power; the raw 0–100 score is not consulted here.
        if (!signalMeetsThreshold(u.signal, minSignal)) {
          belowSignal++;
          continue;
        }
        for (const address of addressesOf(u)) {
          if (seen.has(address)) continue;
          seen.add(address);
          rows.push({ address, project, hsUsername: u.username ?? null });
          contributed++;
        }
      }
      log(
        'highsignal',
        `project "${project}": ${users.length} users (${belowSignal} below ${minSignal} signal) ` +
          `→ ${contributed} new eth address(es)`,
      );
    }

    return rows;
  }

  async fetchIdentities(addresses: string[]): Promise<IdentityRow[]> {
    const users = await this.allUsers();
    const byAddress = new Map<string, HighSignalUser>();
    for (const u of users) for (const a of addressesOf(u)) byAddress.set(a, u);

    const rows: IdentityRow[] = [];
    for (const address of addresses) {
      const key = address.toLowerCase();
      const user = byAddress.get(key);
      if (!user) continue;
      const linked = [...new Set(addressesOf(user))].filter((a) => a !== key);
      if (linked.length === 0) continue; // nothing to observe beyond the primary
      rows.push({ address: key, hsUsername: user.username ?? null, linkedAddresses: linked });
    }
    log('highsignal', `linked ${rows.length} identit(ies) to extra eth address(es)`);
    return rows;
  }

  private async fetchAllUsers(project: string = HIGHSIGNAL_PROJECT): Promise<HighSignalUser[]> {
    const all: HighSignalUser[] = [];
    let page = 1;
    let maxPage = 1;

    do {
      const url = this.pageUrl(page, project);
      const body = await withRetry(`highsignal ${project} page ${page}`, () =>
        fetchJson<HighSignalPage>(url),
      );

      if (!Array.isArray(body?.data)) {
        throw new Error(`Unexpected HighSignal response from ${redact(url)}: missing "data" array.`);
      }
      all.push(...body.data);

      maxPage = Number.isFinite(body.maxPage) && body.maxPage > 0 ? body.maxPage : page;
      if (page === 1) {
        log('highsignal', `fetching ${body.totalResults ?? '?'} users across ${maxPage} page(s) [${project}]`);
      }
      page++;
    } while (page <= maxPage && page <= MAX_PAGES);

    return all;
  }

  private pageUrl(page: number, project: string = HIGHSIGNAL_PROJECT): string {
    const params = new URLSearchParams({ project, page: String(page) });
    // The admin apiKey belongs to HIGHSIGNAL_PROJECT (ssv) only. Every other
    // community is public and MUST be queried WITHOUT a key — sending the SSV
    // key against them 401s ("that API key is for a different project").
    if (project === HIGHSIGNAL_PROJECT) params.set('apiKey', this.apiKey);
    return `${HIGHSIGNAL_API}?${params.toString()}`;
  }
}
