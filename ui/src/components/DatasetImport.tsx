import { useCallback, useRef, useState } from 'react';
import { describeDataset, type Dataset } from '../../../scoring-core/index.js';
import type { DatasetSource } from '../useDataset.js';

type Import = (file: File) => Promise<void>;

/** Shared file-picking behaviour: click-to-browse plus drag-and-drop. */
function useFileDrop(importFile: Import) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const take = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        await importFile(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Import failed.');
      } finally {
        setBusy(false);
      }
    },
    [importFile],
  );

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void take(e.dataTransfer.files?.[0]);
    },
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="application/json,.json"
      style={{ display: 'none' }}
      onChange={(e) => {
        void take(e.target.files?.[0]);
        e.target.value = ''; // re-importing the same filename must still fire
      }}
    />
  );

  return { browse: () => inputRef.current?.click(), input, error, busy, dragging, dropProps };
}

/**
 * Shown when no dataset resolved — a fresh deploy, or after clearing an import.
 * This is the state a peer opening a shared link lands in, so it explains where
 * a dataset.json comes from rather than just reporting its absence.
 */
export function DatasetGate({ importFile, notice }: { importFile: Import; notice: string | null }) {
  const { browse, input, error, busy, dragging, dropProps } = useFileDrop(importFile);

  return (
    <div className="gate">
      <div className={`dropzone${dragging ? ' dragging' : ''}`} {...dropProps}>
        <h1>Delegate Score Simulator</h1>
        <p className="lede">
          Drop a <code>dataset.json</code> here to start, or{' '}
          <button className="link" onClick={browse} disabled={busy}>
            choose a file
          </button>
          .
        </p>

        {busy && <div className="hint">Reading…</div>}
        {error && <div className="gate-error">{error}</div>}
        {notice && !error && <div className="hint">{notice}</div>}

        <div className="gate-note">
          <p>
            The simulator scores a roster from a dataset collected off-chain. It runs entirely in
            your browser — nothing is uploaded, and the file stays on this device.
          </p>
          <p>
            Someone on the team generates one with <code>npm run collect</code> and shares the
            resulting <code>data/dataset.json</code>. It is remembered here until you clear it.
          </p>
        </div>
      </div>
      {input}
    </div>
  );
}

/** Header control: names the dataset in use and swaps it without a reload. */
export function DatasetBadge({
  dataset,
  source,
  importFile,
  onReset,
}: {
  dataset: Dataset;
  source: DatasetSource;
  importFile: Import;
  onReset: () => void;
}) {
  const { browse, input, error, busy, dragging, dropProps } = useFileDrop(importFile);
  const [open, setOpen] = useState(false);

  return (
    <div className="dataset-badge" {...dropProps}>
      <button className={dragging ? 'dragging' : ''} onClick={() => setOpen((v) => !v)}>
        {source.kind === 'imported' ? source.name : 'bundled dataset'} ▾
      </button>

      {open && (
        <div className="dataset-menu">
          <div className="hint">{describeDataset(dataset)}</div>
          <div className="hint">
            {source.kind === 'imported'
              ? `Imported ${source.importedAt.slice(0, 10)} · saved in this browser`
              : 'Shipped with this deployment'}
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button onClick={browse} disabled={busy}>
              {busy ? 'Reading…' : 'Import…'}
            </button>
            {source.kind === 'imported' && <button onClick={onReset}>Clear</button>}
          </div>
          {error && <div className="gate-error">{error}</div>}
        </div>
      )}
      {input}
    </div>
  );
}
