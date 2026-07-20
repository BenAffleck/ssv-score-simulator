/**
 * Archive-RPC access: block-height-per-date resolution and batched balance reads.
 */
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { requireArchiveRpcUrl, requireTokenAddresses } from '../config.js';
import { dateToTs } from '../scoring-core/dates.js';
import { cacheBlock, getCachedBlock, type DB } from './db.js';
import { chunk, log, withRetry } from './util.js';

export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * NEVER enable JSON-RPC batching here.
 *
 * When Infura throttles a request inside a batch it does not return a valid
 * JSON-RPC error object. It returns a bare, id-less blob:
 *
 *   {"code": -32005, "message": "Too Many Requests", "data": {...}}
 *
 * — no `jsonrpc`, no `id`, and the error fields at the top level rather than
 * nested under `"error"`. viem pairs batched responses to requests by `id`, so
 * this matches nothing and the call resolves *empty* instead of throwing.
 *
 * That turns a rate limit into silent, plausible-looking wrong answers:
 * `eth_getBlockByNumber` → "block could not be found" for blocks that plainly
 * exist, `eth_getCode` → "no code" for deployed tokens, `aggregate3` → "0x".
 * The last two are the dangerous ones — `hasCodeAt` reads a throttled response
 * as "not deployed yet" and writes a 0 balance, corrupting the TWAB with no
 * error at all.
 *
 * Unbatched, a 429 arrives as an HTTP status that viem surfaces properly and
 * `withRetry` can actually back off on.
 */
export function makeClient(): PublicClient {
  const url = requireArchiveRpcUrl();
  return createPublicClient({
    chain: mainnet,
    transport: http(url, { batch: false, retryCount: 3, timeout: 30_000 }),
  }) as PublicClient;
}

/**
 * Keep the whole 50-address chunk (100 `balanceOf` calls ≈ 3.6 KB of calldata)
 * in ONE aggregate3 request. viem's 1024-byte default would split it into four
 * requests fired concurrently via `Promise.allSettled` — four times the
 * throughput against the rate limiter for identical data.
 */
const MULTICALL_BATCH_SIZE = 8_192;

/** 18-dec wei → decimal SSV. */
export const toDecimal = (wei: bigint): number => Number(wei) / 1e18;

/**
 * Highest block whose timestamp is ≤ the date's UTC midnight, by binary search.
 * Cached per date, and each search is seeded with `lowerBound` (the previous
 * day's block) so a sequential backfill stays cheap.
 */
export async function blockForDate(
  client: PublicClient,
  db: DB,
  date: string,
  lowerBound = 1n,
  latestBlock?: bigint,
): Promise<bigint> {
  const cached = getCachedBlock(db, date);
  if (cached !== null) return BigInt(cached);

  const target = BigInt(dateToTs(date));
  const timestampAt = async (block: bigint): Promise<bigint> =>
    (await withRetry(`getBlock(${block})`, () => client.getBlock({ blockNumber: block }))).timestamp;

  const latest = latestBlock ?? (await withRetry('eth_blockNumber', () => client.getBlockNumber()));
  if ((await timestampAt(latest)) <= target) {
    cacheBlock(db, date, Number(latest));
    return latest;
  }

  // Bracket the target instead of binary-searching the whole chain. A
  // sequential backfill hands us the previous day's block as `lowerBound`, so
  // the answer is normally ~7200 blocks away — searching [lo, latest] would
  // cost ~25 getBlock calls per day (≈6k per run) and is a big part of why
  // rate-limited endpoints start failing.
  let lo = lowerBound < 1n ? 1n : lowerBound;
  let span = 8_192n;
  let hi = lo;
  for (;;) {
    hi = lo + span > latest ? latest : lo + span;
    if (hi === latest || (await timestampAt(hi)) > target) break;
    lo = hi;
    span *= 2n;
  }

  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if ((await timestampAt(mid)) <= target) lo = mid;
    else hi = mid - 1n;
  }

  cacheBlock(db, date, Number(lo));
  return lo;
}

type MulticallResult =
  | { status: 'success'; result: bigint }
  | { status: 'failure'; error: unknown };

export interface BalancePair {
  ssvErc20: number;
  cssv: number;
}

/**
 * Was `token` deployed as of `blockNumber`? Cached per (token, block).
 *
 * Only consulted when a call fails, so the happy path costs nothing. It is
 * what separates "the token did not exist yet" (a true zero) from "the call
 * broke" (a real error we must not paper over).
 */
async function hasCodeAt(
  client: PublicClient,
  token: string,
  blockNumber: bigint,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const key = `${token.toLowerCase()}@${blockNumber}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const codeAt = async (block?: bigint): Promise<string | undefined> =>
    withRetry(`getCode(${token}@${block ?? 'latest'})`, () =>
      client.getCode({ address: token as Address, ...(block === undefined ? {} : { blockNumber: block }) }),
    );

  const code = await codeAt(blockNumber);
  let exists = !!code && code !== '0x';

  /**
   * "No code" is the one answer we must not take on faith: it is the branch
   * that converts a failed read into a 0 balance, so a wrong `false` here
   * silently corrupts the holdings series. An empty `eth_getCode` is also
   * exactly what a throttled RPC hands back.
   *
   * A genuine pre-deploy token has no code at `blockNumber` AND is younger
   * than it. So if the token has code at HEAD, confirm the negative against a
   * known-deployed reference before trusting it.
   */
  if (!exists) {
    const headCode = await codeAt();
    if (!!headCode && headCode !== '0x') {
      const recheck = await codeAt(blockNumber);
      exists = !!recheck && recheck !== '0x';
      if (exists) {
        log(
          'balances',
          `getCode(${token}@${blockNumber}) first returned "0x" but the token has code at head ` +
            'and re-reads fine — the empty response was an RPC artefact, not a pre-deploy block.',
        );
      }
    }
  }

  cache.set(key, exists);
  return exists;
}

/** Tokens already reported as not-yet-deployed, so we log once, not per day. */
const announcedPredeploy = new Set<string>();

/**
 * SSV `balanceOf` + cSSV `balanceOf` for every address at one historical
 * block, via multicall. Holdings base = SSV + cSSV, 1:1.
 *
 * Holding nothing is NOT an error: `balanceOf` returns 0 for a non-holder, and
 * plenty of delegates hold neither SSV nor cSSV. Those simply score 0 on the
 * holdings pillar.
 *
 * A failed sub-call is only coerced to 0 when we can prove the contract had no
 * code at that block (it did not exist yet, so 0 is the truth). Any other
 * failure is surfaced — a silent zero would corrupt the TWAB and, for cSSV,
 * drop a whole component of the holdings base.
 */
export async function readBalancesAt(
  client: PublicClient,
  addresses: string[],
  blockNumber: bigint,
): Promise<Map<string, BalancePair>> {
  const { ssv, cssv } = requireTokenAddresses();
  const out = new Map<string, BalancePair>();
  const codeCache = new Map<string, boolean>();

  for (const batch of chunk(addresses, 50)) {
    const contracts = batch.flatMap((address) => [
      { address: ssv as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address as Address] },
      { address: cssv as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address as Address] },
    ]);

    /**
     * `allowFailure: true` means a transport-level failure does NOT throw —
     * viem reports it as the affected sub-calls having `status: 'failure'`.
     * Left alone, a transient RPC hiccup would look like "the token is broken"
     * and abort the whole backfill, and the retry wrapper would never fire
     * because the promise resolved.
     *
     * Crucially this is a *partial* signal: viem splits `contracts` into
     * several aggregate3 calls (one per `batchSize` bytes of calldata, 1024 by
     * default) and runs them through `Promise.allSettled`. One rate-limited
     * chunk therefore fails while its siblings succeed — so "did every result
     * fail?" is the wrong question. Any failure is enough.
     *
     * And a failure is always transient when the token has code: `balanceOf`
     * returns 0 for a non-holder, it does not revert. So if both contracts
     * demonstrably exist at this block, a failed read is a transport problem —
     * throw, and let withRetry back off and try again.
     */
    let lastResults: MulticallResult[] = [];

    const attempt = async (): Promise<MulticallResult[]> => {
      const batchResults = (await client.multicall({
        contracts: contracts as unknown as Parameters<PublicClient['multicall']>[0]['contracts'],
        blockNumber,
        allowFailure: true,
        batchSize: MULTICALL_BATCH_SIZE,
      })) as MulticallResult[];
      lastResults = batchResults;

      const failures = batchResults.filter((r) => r.status === 'failure');

      if (failures.length > 0) {
        const [ssvLive, cssvLive] = await Promise.all([
          hasCodeAt(client, ssv, blockNumber, codeCache),
          hasCodeAt(client, cssv, blockNumber, codeCache),
        ]);
        // Both deployed → the calls should have worked → transient. Retry.
        // Otherwise fall through to per-result handling, which scores an
        // undeployed token as 0.
        if (ssvLive && cssvLive) {
          throw new Error(
            `${failures.length}/${batchResults.length} multicall sub-call(s) returned no data ` +
              `at block ${blockNumber} (${describe(failures[0]?.error)}) — both tokens are ` +
              'deployed here, so this looks like a transient RPC error or rate limit',
          );
        }
      }

      return batchResults;
    };

    /**
     * If the backoff is exhausted the failure is no longer plausibly transient,
     * so hand the last results to the per-result path below rather than letting
     * the generic retry error propagate: `resolve` names the address, the token
     * and the likely cause, which is what actually makes the run debuggable.
     */
    let results: MulticallResult[];
    try {
      results = await withRetry(`multicall@${blockNumber}`, attempt);
    } catch {
      results = lastResults;
    }

    /**
     * Resolve one token read: success → its value; failure → 0 if the token
     * was not yet deployed, otherwise throw with a diagnosis.
     */
    const resolve = async (
      res: MulticallResult | undefined,
      token: string,
      label: string,
      address: string,
      hint: string,
    ): Promise<number> => {
      if (res?.status === 'success') return toDecimal(res.result);

      if (!(await hasCodeAt(client, token, blockNumber, codeCache))) {
        const key = `${label}@${blockNumber}`;
        if (!announcedPredeploy.has(key)) {
          announcedPredeploy.add(key);
          log(
            'balances',
            `${label} (${token}) has no code at block ${blockNumber} — not deployed yet; ` +
              'counting it as 0 for this date.',
          );
        }
        return 0;
      }

      throw new Error(
        `${label} read failed for ${address} at block ${blockNumber}: ${describe(res?.error)}\n` +
          '  → This survived 5 retries with backoff. If it reads "returned no data (0x)", the\n' +
          '    usual cause is still RPC rate limiting — re-run (the collector is idempotent and\n' +
          '    resumes from the last completed day), or move to a higher-throughput endpoint.\n' +
          `  → ${hint}`,
      );
    };

    for (const [i, address] of batch.entries()) {
      const [ssvRes, cssvRes] = [results[i * 2], results[i * 2 + 1]];

      const ssvErc20 = await resolve(
        ssvRes,
        ssv,
        'SSV balanceOf',
        address,
        'Is ARCHIVE_RPC_URL a real archive node? Full nodes cannot serve historical state.',
      );

      const cssvBalance = await resolve(
        cssvRes,
        cssv,
        'cSSV balanceOf',
        address,
        'cSSV is part of the holdings base (1:1 with SSV) and must not be dropped. Check CSSV_ADDRESS.',
      );

      out.set(address.toLowerCase(), { ssvErc20, cssv: cssvBalance });
    }
  }

  return out;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0]! : String(err ?? 'unknown error');
}

export { log };
