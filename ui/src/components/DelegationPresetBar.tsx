import { useRef, useState } from 'react';
import {
  exportDelegationPreset,
  parseDelegationPreset,
  type DelegationConfig,
} from '../../../scoring-core/index.js';

interface Props {
  delegation: DelegationConfig;
  onImport: (delegation: DelegationConfig) => void;
  onReset: () => void;
}

/**
 * Export/import the delegation impact setup — cohort split, gating and the
 * per-entity assignments — as its own JSON file. Kept deliberately separate
 * from the scoring preset so the two are never mixed in one file.
 */
export function DelegationPresetBar({ delegation, onImport, onReset }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 2600);
  };

  const download = () => {
    const preset = exportDelegationPreset(delegation, 'delegation-preset');
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delegation-preset-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Delegation exported.');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(exportDelegationPreset(delegation, 'clipboard'), null, 2),
      );
      flash('Delegation copied to clipboard.');
    } catch {
      flash('Clipboard blocked — use Export instead.');
    }
  };

  const importFile = async (file: File) => {
    try {
      onImport(parseDelegationPreset(JSON.parse(await file.text())));
      flash(`Imported ${file.name}`);
    } catch (err) {
      flash(`Import failed: ${err instanceof Error ? err.message : 'invalid JSON'}`);
    }
  };

  return (
    <>
      <div className="btn-row">
        <button onClick={download}>Export</button>
        <button onClick={() => fileRef.current?.click()}>Import…</button>
        <button onClick={copy}>Copy</button>
        <button onClick={onReset}>Reset cohorts</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
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
