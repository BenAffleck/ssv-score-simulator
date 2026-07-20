import { useRef, useState } from 'react';
import { exportPreset, parsePreset, type ScoringParams } from '../../../scoring-core/index.js';

interface Props {
  params: ScoringParams;
  onImport: (params: ScoringParams) => void;
  onReset: () => void;
}

/**
 * Export/import parameter presets as JSON. Import runs the same
 * `parsePreset` the tests round-trip against, so a re-imported preset
 * reproduces identical scores.
 */
export function PresetBar({ params, onImport, onReset }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 2600);
  };

  const download = () => {
    const preset = exportPreset(params, 'delegate-score-preset');
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delegate-score-preset-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Preset exported.');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportPreset(params, 'clipboard'), null, 2));
      flash('Preset copied to clipboard.');
    } catch {
      flash('Clipboard blocked — use Export instead.');
    }
  };

  const importFile = async (file: File) => {
    try {
      onImport(parsePreset(JSON.parse(await file.text())));
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
        <button onClick={onReset}>Proposal defaults</button>
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
