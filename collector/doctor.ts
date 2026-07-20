/**
 * `npm run doctor` — checks whether ARCHIVE_RPC_URL can actually serve the
 * historical state the backfill needs, and reports how far back it reaches.
 *
 * Reads .env itself and never prints the URL or key — only the hostname.
 */
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { BACKFILL_DAYS, requireArchiveRpcUrl, requireTokenAddresses } from '../config.js';
import { DAY_SECONDS } from '../scoring-core/dates.js';
import { ERC20_ABI } from './rpc.js';
import { errMessage, log } from './util.js';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as Address;
const PROBE = '0x000000000000000000000000000000000000dEaD' as Address;

/** Hostname only — the path/query usually carries the API key. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '<unparseable URL>';
  }
}

const short = (err: unknown): string => errMessage(err).split('\n')[0]!.slice(0, 120);

async function main(): Promise<void> {
  const url = requireArchiveRpcUrl();
  const { ssv, cssv } = requireTokenAddresses();
  const client = createPublicClient({
    chain: mainnet,
    transport: http(url, { retryCount: 1, timeout: 20_000 }),
  }) as PublicClient;

  log('doctor', `endpoint host: ${safeHost(url)}`);

  const latest = await client.getBlockNumber();
  log('doctor', `latest block: ${latest}`);

  // How far back does the backfill actually need to reach?
  const needed = latest - BigInt(Math.ceil((BACKFILL_DAYS * DAY_SECONDS) / 12));
  log('doctor', `backfill of ${BACKFILL_DAYS}d needs state back to ~block ${needed}`);

  /** Read one token's balanceOf at a block, distinguishing "no code" from "no state". */
  const tokenAt = async (token: string, block: bigint): Promise<string> => {
    const code = await client.getCode({ address: token as Address, blockNumber: block });
    if (!code || code === '0x') return 'pre-deploy';
    try {
      await client.readContract({
        address: token as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [PROBE],
        blockNumber: block,
      });
      return 'ok';
    } catch (err) {
      return `FAIL: ${short(err).slice(0, 40)}`;
    }
  };

  console.log('\n  block         age      multicall3  SSV         cSSV');
  console.log('  ────────────────────────────────────────────────────────────');

  const offsets: Array<[string, bigint]> = [
    ['now', 0n],
    ['~1h', 300n],
    ['~1d', 7_200n],
    ['~7d', 50_400n],
    ['~30d', 216_000n],
    ['~90d', 648_000n],
    [`~${BACKFILL_DAYS}d`, BigInt(Math.ceil((BACKFILL_DAYS * DAY_SECONDS) / 12))],
  ];

  let deepestState: bigint | null = null;
  let stateGap = false;

  for (const [label, back] of offsets) {
    const block = latest > back ? latest - back : 1n;
    let mc = '?';
    try {
      const c = await client.getCode({ address: MULTICALL3, blockNumber: block });
      mc = c && c !== '0x' ? 'yes' : 'NO';
    } catch (err) {
      mc = `err(${short(err).slice(0, 16)})`;
    }

    const ssvState = await tokenAt(ssv, block);
    const cssvState = await tokenAt(cssv, block);

    // SSV has existed for years, so it is the honest probe for archive depth.
    if (ssvState === 'ok') deepestState = block;
    else if (ssvState.startsWith('FAIL')) stateGap = true;

    console.log(
      `  ${String(block).padEnd(12)} ${label.padEnd(8)} ${mc.padEnd(11)} ` +
        `${ssvState.padEnd(11)} ${cssvState}`,
    );
  }

  console.log('');

  if (deepestState === null) {
    log('doctor', '✖ Could not read SSV state at any tested block. Check the endpoint and SSV_ADDRESS.');
  } else if (deepestState === latest || stateGap) {
    const days = (Number(latest - deepestState) * 12) / DAY_SECONDS;
    log('doctor', `✖ Historical state runs out at ~${days.toFixed(0)} days back — this is not a full archive node.`);
    log('doctor', `  → Use an archive endpoint, or run: npm run collect -- --days=${Math.max(1, Math.floor(days))}`);
  } else {
    log('doctor', `✓ Archive state reaches the full ${BACKFILL_DAYS}d window (SSV readable throughout).`);
  }

  log(
    'doctor',
    'Note: "pre-deploy" in the cSSV column is expected and harmless — cSSV did not exist ' +
      'before block 24719189, so it correctly counts as 0 on earlier dates.',
  );
  log('doctor', 'A one-off "returned no data (0x)" on a recent block is a transient RPC error; the collector now retries it.');
}

main().catch((err) => {
  console.error(`\n✖ doctor failed: ${errMessage(err)}\n`);
  process.exit(1);
});
