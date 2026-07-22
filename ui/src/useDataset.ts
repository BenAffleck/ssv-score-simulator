import { useCallback, useEffect, useState } from 'react';
import { parseDataset, type Dataset } from '../../scoring-core/index.js';
import { clearStored, loadStored, saveStored } from './datasetStore.js';

/** Where the dataset in hand came from — shown in the header so it is never ambiguous. */
export type DatasetSource =
  | { kind: 'bundled' }
  | { kind: 'imported'; name: string; importedAt: string };

export type DatasetState =
  | { status: 'loading' }
  /** No dataset anywhere — a fresh deploy. Not an error; the import gate handles it. */
  | { status: 'empty'; notice: string | null }
  | { status: 'ready'; dataset: Dataset; source: DatasetSource };

export interface DatasetApi {
  state: DatasetState;
  /** Throws a DatasetError with a readable message if the file is not a dataset. */
  importFile: (file: File) => Promise<void>;
  /** Drop the imported dataset and fall back to the bundled one, if any. */
  reset: () => Promise<void>;
}

/**
 * Resolves a dataset from, in order:
 *
 *   1. one previously imported by hand (IndexedDB) — an explicit choice wins;
 *   2. `/dataset.json` bundled with the build, if the deploy shipped one.
 *
 * Neither is required. A deploy with no dataset lands in `empty` and waits for
 * an import, which is the whole point: the build no longer has to carry a
 * git-ignored file to boot.
 */
export function useDataset(url = '/dataset.json'): DatasetApi {
  const [state, setState] = useState<DatasetState>({ status: 'loading' });

  const loadBundled = useCallback(async (): Promise<DatasetState> => {
    try {
      const res = await fetch(url);
      // A deploy without a dataset is the expected case, not a failure. Static
      // hosts answer a missing file with 404 — or with index.html and a 200,
      // which is why the parse below has to be the real check.
      if (!res.ok) return { status: 'empty', notice: null };
      return { status: 'ready', dataset: parseDataset(await res.json()), source: { kind: 'bundled' } };
    } catch {
      return { status: 'empty', notice: null };
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await loadStored();
      if (cancelled) return;

      if (stored) {
        try {
          setState({
            status: 'ready',
            // Re-validated on every load: the stored copy may predate a schema change.
            dataset: parseDataset(stored.dataset),
            source: { kind: 'imported', name: stored.sourceName, importedAt: stored.importedAt },
          });
          return;
        } catch {
          await clearStored(); // unusable — fall through to the bundled one
        }
      }

      const next = await loadBundled();
      if (!cancelled) setState(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [loadBundled]);

  const importFile = useCallback(async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      throw new Error(`Could not read ${file.name}.`);
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `${file.name} is not valid JSON — ${err instanceof Error ? err.message : 'parse failed'}. ` +
          'A truncated download is the usual cause.',
      );
    }

    // Parse before storing, so a bad file can never take the app down on reload.
    const dataset = parseDataset(json);
    const importedAt = new Date().toISOString();

    try {
      await saveStored({ dataset, sourceName: file.name, importedAt });
    } catch {
      // Storage blocked (private browsing, quota). The dataset is fine and the
      // session works — only persistence across reloads is lost, so say so
      // rather than failing an import that actually succeeded.
      setState({ status: 'ready', dataset, source: { kind: 'imported', name: file.name, importedAt } });
      throw new Error(
        `Loaded ${file.name}, but it could not be saved for next time ` +
          '(browser storage is full or blocked). It will need re-importing after a reload.',
      );
    }

    setState({ status: 'ready', dataset, source: { kind: 'imported', name: file.name, importedAt } });
  }, []);

  const reset = useCallback(async () => {
    await clearStored();
    setState({ status: 'loading' });
    setState(await loadBundled());
  }, [loadBundled]);

  return { state, importFile, reset };
}
