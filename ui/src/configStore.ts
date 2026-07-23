/**
 * Persistence for the delegation config (total delegatable, cohort percentages,
 * thresholds, and per-entity cohort assignments), so the analysis survives a
 * reload without re-typing.
 *
 * A small, separate IndexedDB database from the dataset store — the config is a
 * few KB and its own version line avoids coupling the two stores' schema bumps.
 * Like the dataset store, reads degrade to null and writes surface failures.
 */
import type { DelegationConfig } from '../../scoring-core/index.js';

const DB_NAME = 'delegate-score-sim-config';
const DB_VERSION = 1;
const STORE = 'config';
const KEY = 'delegation';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      }).finally(() => db.close()),
  );
}

export async function loadDelegationConfig(): Promise<DelegationConfig | null> {
  try {
    return (await tx<DelegationConfig | undefined>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function saveDelegationConfig(config: DelegationConfig): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(config, KEY));
  } catch {
    /* storage blocked — the session still works, config just won't persist */
  }
}
