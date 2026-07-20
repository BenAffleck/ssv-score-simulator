/**
 * Balance-read robustness. Most delegates hold neither SSV nor cSSV, and the
 * backfill can reach back before a token was deployed — neither may abort a run.
 */
import { describe, expect, it } from 'vitest';
import type { PublicClient } from 'viem';
import { CSSV_ADDRESS, SSV_ADDRESS } from '../../config.js';
import { readBalancesAt } from '../rpc.js';

type Result = { status: 'success'; result: bigint } | { status: 'failure'; error: Error };

const ok = (amount: number): Result => ({
  status: 'success',
  result: BigInt(Math.round(amount * 1e18)),
});
const fail = (msg = 'ContractFunctionExecutionError'): Result => ({
  status: 'failure',
  error: new Error(msg),
});

/**
 * Stub client. `pairs` supplies [ssv, cssv] per address in order; `code`
 * decides which contracts have code at the queried block.
 */
function stubClient(pairs: Result[][], code: Record<string, boolean> = {}): PublicClient {
  return {
    multicall: async () => pairs.flat(),
    getCode: async ({ address }: { address: string }) =>
      (code[address.toLowerCase()] ?? true) ? '0xdeadbeef' : '0x',
  } as unknown as PublicClient;
}

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('delegates who hold nothing', () => {
  it('records zeros without failing — holding no SSV or cSSV is not an error', async () => {
    const out = await readBalancesAt(stubClient([[ok(0), ok(0)]]), [A], 100n);
    expect(out.get(A)).toEqual({ ssvErc20: 0, cssv: 0 });
  });

  it('handles a roster where only some delegates hold anything', async () => {
    const client = stubClient([
      [ok(0), ok(6000.7)], // cSSV only — the common real case
      [ok(0), ok(0)],      // holds nothing at all
    ]);
    const out = await readBalancesAt(client, [A, B], 100n);
    expect(out.get(A)!.cssv).toBeCloseTo(6000.7, 6);
    expect(out.get(B)).toEqual({ ssvErc20: 0, cssv: 0 });
  });

  it('sums SSV and cSSV at parity', async () => {
    const out = await readBalancesAt(stubClient([[ok(213.28), ok(100)]]), [A], 100n);
    const { ssvErc20, cssv } = out.get(A)!;
    expect(ssvErc20 + cssv).toBeCloseTo(313.28, 6);
  });
});

describe('token not yet deployed at the backfilled block', () => {
  it('counts cSSV as 0 rather than aborting the whole run', async () => {
    // balanceOf against an address with no code fails; cSSV has no code here.
    const client = stubClient([[ok(500), fail()]], { [CSSV_ADDRESS.toLowerCase()]: false });
    const out = await readBalancesAt(client, [A], 100n);
    expect(out.get(A)).toEqual({ ssvErc20: 500, cssv: 0 });
  });

  it('still collects every other delegate on that date', async () => {
    const client = stubClient([[ok(500), fail()], [ok(0), fail()]], {
      [CSSV_ADDRESS.toLowerCase()]: false,
    });
    const out = await readBalancesAt(client, [A, B], 100n);
    expect(out.size).toBe(2);
    expect(out.get(A)!.ssvErc20).toBe(500);
  });
});

describe('transient RPC failures are retried, not fatal', () => {
  /**
   * Regression: `allowFailure: true` converts a transport-level failure into
   * every sub-call being marked "failure" rather than throwing, so the retry
   * wrapper never fired and one hiccup aborted an entire multi-day backfill.
   */
  it('retries a batch where every sub-call failed but both tokens are deployed', async () => {
    let calls = 0;
    const client = {
      multicall: async () => {
        calls++;
        // First attempt: the whole aggregate3 came back empty.
        if (calls === 1) return [fail('returned no data ("0x")'), fail('returned no data ("0x")')];
        return [ok(500), ok(250)];
      },
      getCode: async () => '0xdeadbeef', // both tokens live at this block
    } as unknown as PublicClient;

    const out = await readBalancesAt(client, [A], 100n);
    expect(calls).toBeGreaterThan(1); // it retried instead of giving up
    expect(out.get(A)).toEqual({ ssvErc20: 500, cssv: 250 });
  });

  it('does not retry when the batch failed because a token was not deployed', async () => {
    let calls = 0;
    const client = {
      multicall: async () => {
        calls++;
        return [fail(), fail()];
      },
      getCode: async () => '0x', // neither token exists at this block
    } as unknown as PublicClient;

    const out = await readBalancesAt(client, [A], 100n);
    expect(calls).toBe(1); // pre-deploy is a real answer, not a transient error
    expect(out.get(A)).toEqual({ ssvErc20: 0, cssv: 0 });
  });
});

describe('partial multicall failures are retried', () => {
  /**
   * viem splits `contracts` into several aggregate3 calls (one per 1024 bytes
   * of calldata) and settles them independently, so a rate-limited chunk fails
   * while its siblings succeed. Retrying only when *every* sub-call failed let
   * that case through as a hard error and aborted the backfill mid-run.
   */
  it('retries when only one chunk failed and the rest succeeded', async () => {
    let calls = 0;
    const client = {
      multicall: async () => {
        calls++;
        // First attempt: B's chunk got rate-limited, A's came back fine.
        if (calls === 1) return [ok(213.28), ok(100), fail('returned no data ("0x")'), fail('returned no data ("0x")')];
        return [ok(213.28), ok(100), ok(50), ok(25)];
      },
      getCode: async () => '0xdeadbeef',
    } as unknown as PublicClient;

    const out = await readBalancesAt(client, [A, B], 100n);
    expect(calls).toBe(2);
    expect(out.get(B)).toEqual({ ssvErc20: 50, cssv: 25 });
  }, 20_000);
});

/**
 * A failure against a *deployed* token is retried first (it is indistinguishable
 * from a rate limit up front), so each of these spends the full withRetry
 * backoff — ~7.5s — before surfacing. Hence the widened timeouts.
 */
describe('genuine read failures still abort', () => {
  it('throws when cSSV IS deployed but the call failed', async () => {
    const client = stubClient([[ok(500), fail('rpc exploded')]], {
      [CSSV_ADDRESS.toLowerCase()]: true,
    });
    await expect(readBalancesAt(client, [A], 100n)).rejects.toThrow(/cSSV balanceOf read failed/);
  }, 20_000);

  it('never silently drops cSSV for a deployed contract', async () => {
    const client = stubClient([[ok(500), fail()]], { [CSSV_ADDRESS.toLowerCase()]: true });
    await expect(readBalancesAt(client, [A], 100n)).rejects.toThrow(/must not be dropped/);
  }, 20_000);

  it('throws on an SSV failure and points at the archive-node requirement', async () => {
    const client = stubClient([[fail('missing trie node'), ok(0)]], {
      [SSV_ADDRESS.toLowerCase()]: true,
    });
    await expect(readBalancesAt(client, [A], 100n)).rejects.toThrow(/archive node/);
  }, 20_000);
});
