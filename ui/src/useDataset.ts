import { useEffect, useState } from 'react';
import type { Dataset } from '../../scoring-core/index.js';

type State =
  | { status: 'loading' }
  | { status: 'ready'; dataset: Dataset }
  | { status: 'error'; message: string };

/** Loads data/dataset.json, which Vite serves from the project's data/ dir. */
export function useDataset(url = '/dataset.json'): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
        const dataset = (await res.json()) as Dataset;
        if (!dataset?.delegates?.length) throw new Error('dataset.json contains no delegates.');
        if (!cancelled) setState({ status: 'ready', dataset });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
