/**
 * Persistence for the scenario being edited, so it survives a reload. A small
 * IndexedDB store of its own; reads degrade to null, and a stored scenario is
 * re-validated with the same parsers as an imported config file.
 */
import {
  parseDelegation,
  parseNominations,
  parseParams,
  type Scenario,
} from '../../scoring-core/index.js';

const DB_NAME = 'delegate-score-sim-config';
const DB_VERSION = 2;
const STORE = 'config';
const KEY = 'scenario';

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

/** The stored scenario for the dataset `origin`, or null when none is stored or it no longer parses. */
export async function loadScenario(origin: string): Promise<Scenario | null> {
  try {
    const stored = await tx<{ origin: string; scenario: Scenario } | undefined>('readonly', (s) => s.get(KEY));
    if (!stored || stored.origin !== origin) return null;
    const s = stored.scenario;
    return {
      params: parseParams(s.params),
      delegation: parseDelegation(s.delegation),
      pool: typeof s.pool === 'number' && s.pool >= 0 ? s.pool : null,
      nominations: parseNominations(s.nominations),
      sources: Array.isArray(s.sources) ? s.sources.filter((x) => typeof x === 'string') : null,
    };
  } catch {
    return null;
  }
}

export async function saveScenario(origin: string, scenario: Scenario): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put({ origin, scenario }, KEY));
  } catch {
    /* storage blocked — the session still works, the scenario just won't persist */
  }
}
