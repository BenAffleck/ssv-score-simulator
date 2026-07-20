/**
 * Derived + required configuration (SPEC §3).
 *
 * Collector-side only. The UI never imports this file — it gets its defaults
 * from `scoring-core/params.ts`, which is pure and free of env/Node deps.
 */
import 'dotenv/config';

// ---------------------------------------------------------------------------
// Derived config — real values from the DAOx project. Safe defaults.
// ---------------------------------------------------------------------------

export const CHAIN_ID = 1;
export const TOKEN_DECIMALS = 18;

export const SNAPSHOT_SPACE = process.env.SNAPSHOT_SPACE ?? 'mainnet.ssvnetwork.eth';
export const SNAPSHOT_API = process.env.SNAPSHOT_API ?? 'https://hub.snapshot.org/graphql';
export const GNOSIS_DELEGATION_API = 'https://delegate-api.gnosisguild.org/api/v1';
export const HIGHSIGNAL_API = 'https://app.highsignal.xyz/api/users';
export const HIGHSIGNAL_PROJECT = 'ssv';

/** SSV ERC-20 (chain 1, 18 dec). */
export const SSV_ADDRESS = process.env.SSV_ADDRESS ?? '0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54';
/** cSSV ERC-20 — counted 1:1 with SSV in the holdings base. */
export const CSSV_ADDRESS = process.env.CSSV_ADDRESS ?? '0xe018D31F120A637828F46aFD6c64EC099d960546';

/**
 * cSSV was not deployed before this block. Used ONLY for up-front warnings and
 * diagnostics — the collector's actual behaviour is driven by an on-chain
 * `getCode` check, which stays authoritative if this number is off.
 *
 * Backfilling past it is fine: cSSV is legitimately 0 on those dates.
 */
export const CSSV_DEPLOY_BLOCK = 24_719_189n;

export const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS ?? 240);
export const HIGHSIGNAL_SOURCE = (process.env.HIGHSIGNAL_SOURCE ?? 'http') as 'http' | 'csv';

// Paths
export const DATA_DIR = new URL('./data/', import.meta.url).pathname;
export const SQLITE_PATH = `${DATA_DIR}sim.sqlite`;
export const DATASET_PATH = `${DATA_DIR}dataset.json`;
export const DELEGATES_CSV = `${DATA_DIR}delegates.csv`;
export const HIGHSIGNAL_CSV = `${DATA_DIR}highsignal.csv`;

// ---------------------------------------------------------------------------
// Required config — fail fast, name the field (SPEC §9).
// ---------------------------------------------------------------------------

class ConfigError extends Error {
  constructor(field: string, detail: string) {
    super(`Missing/invalid required config: ${field}\n  → ${detail}\n  → Set it in .env (see .env.example).`);
    this.name = 'ConfigError';
  }
}

const isAddress = (v: string | undefined): v is string => !!v && /^0x[0-9a-fA-F]{40}$/.test(v);

/**
 * The archive RPC. Required for any historical `balanceOf` read.
 */
export function requireArchiveRpcUrl(): string {
  const url = process.env.ARCHIVE_RPC_URL?.trim();
  if (!url) {
    throw new ConfigError(
      'ARCHIVE_RPC_URL',
      'An Ethereum ARCHIVE RPC endpoint is required to read balances at historical blocks.',
    );
  }
  if (!/^https?:\/\//.test(url)) {
    throw new ConfigError('ARCHIVE_RPC_URL', `Expected an http(s) URL, got "${url}".`);
  }
  return url;
}

export function requireHighSignalApiKey(): string {
  const key = process.env.HIGHSIGNAL_API_KEY?.trim();
  if (!key) {
    throw new ConfigError(
      'HIGHSIGNAL_API_KEY',
      'Required to authenticate against https://app.highsignal.xyz/api/users. ' +
        'For an offline run set HIGHSIGNAL_SOURCE=csv and provide data/highsignal.csv instead.',
    );
  }
  return key;
}

/**
 * Holdings base = SSV ERC-20 + cSSV, matching the proposal's
 * `H(t) = balance_SSV(t) + balance_cSSV(t)`. Both components are mandatory:
 * silently dropping cSSV would understate every delegate's holdings pillar,
 * so a missing/invalid address is a hard failure (SPEC §9).
 */
export function requireTokenAddresses(): { ssv: string; cssv: string } {
  if (!isAddress(SSV_ADDRESS)) throw new ConfigError('SSV_ADDRESS', `Not a valid address: "${SSV_ADDRESS}".`);
  if (!isAddress(CSSV_ADDRESS)) {
    throw new ConfigError(
      'CSSV_ADDRESS',
      `Not a valid address: "${CSSV_ADDRESS}". cSSV is part of the holdings base (1:1 with SSV) ` +
        'and must never be silently dropped.',
    );
  }
  return { ssv: SSV_ADDRESS, cssv: CSSV_ADDRESS };
}
