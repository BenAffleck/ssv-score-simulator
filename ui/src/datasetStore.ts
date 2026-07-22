/**
 * Persistence for an imported dataset, so a peer imports once and can reload,
 * bookmark and share the URL without re-picking the file every time.
 *
 * IndexedDB rather than localStorage: a real roster's dataset.json runs a few
 * megabytes, and localStorage's ~5 MB quota is both close to that and enforced
 * by throwing mid-write. IndexedDB also stores the parsed object directly,
 * skipping a re-stringify/re-parse on every load.
 */
import type { Dataset } from '../../scoring-core/index.js';

const DB_NAME = 'delegate-score-sim';
const DB_VERSION = 1;
const STORE = 'datasets';
const KEY = 'current';

export interface StoredDataset {
  dataset: Dataset;
  /** Filename it was imported from — shown so you can tell two datasets apart. */
  sourceName: string;
  importedAt: string;
}

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

/**
 * Storage is a convenience, never a requirement: private-browsing modes and
 * blocked-storage settings reject these calls, and the app still works for the
 * session. So read failures degrade to "nothing stored" rather than surfacing.
 */
export async function loadStored(): Promise<StoredDataset | null> {
  try {
    return (await tx<StoredDataset | undefined>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Write failures DO surface — silently losing an import is worse than a warning. */
export async function saveStored(entry: StoredDataset): Promise<void> {
  await tx('readwrite', (s) => s.put(entry, KEY));
}

export async function clearStored(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(KEY));
  } catch {
    /* already gone, or storage blocked */
  }
}
