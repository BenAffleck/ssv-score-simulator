import { useRef, useState } from 'react';
import { download, readConfigFile } from '../download.js';

interface Props {
  /** Production file name, e.g. `params.json`. */
  filename: string;
  text: () => string;
  /** Throws a readable error when the file is not this config. */
  onImport: (content: unknown) => void;
  onReset: () => void;
  resetLabel?: string;
}

/**
 * Export/import one production config file. What is exported is exactly what
 * production reads from `config/<filename>`, so a scenario the DAO ratifies is
 * deployed by committing the file.
 */
export function ConfigFileBar({ filename, text, onImport, onReset, resetLabel = 'Production' }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 3200);
  };

  const importFile = async (file: File) => {
    try {
      onImport(await readConfigFile(file));
      flash(`Imported ${file.name}`);
    } catch (err) {
      flash(`Import failed: ${err instanceof Error ? err.message : 'unreadable file'}`);
    }
  };

  return (
    <>
      <div className="btn-row">
        <button onClick={() => download(filename, text(), filename.endsWith('.csv') ? 'text/csv' : 'application/json')}>
          Export {filename}
        </button>
        <button onClick={() => fileRef.current?.click()}>Import…</button>
        <button onClick={onReset}>{resetLabel}</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.csv,application/json,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = '';
        }}
      />
      {status && <div className="hint" style={{ marginTop: 8 }}>{status}</div>}
    </>
  );
}
