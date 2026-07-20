import type { ScoringParams } from '../../../scoring-core/index.js';
import { NumberField, SelectField, Slider, Toggle } from './Controls.js';
import { PresetBar } from './PresetBar.js';

interface Props {
  params: ScoringParams;
  onChange: (next: ScoringParams) => void;
  onReset: () => void;
}

export function ParamPanel({ params, onChange, onReset }: Props) {
  // Every setter produces a fresh object so React re-renders and the score
  // recomputes — no reload, no server round-trip.
  type GroupKey = 'weights' | 'holdings' | 'votes' | 'community';
  const set = <K extends GroupKey>(key: K, patch: Partial<ScoringParams[K]>) =>
    onChange({ ...params, [key]: { ...params[key], ...patch } });

  const sumW = params.weights.community + params.weights.holdings + params.weights.votes;
  const pct = (w: number) => (sumW > 0 ? `${Math.round((100 * w) / sumW)}%` : '—');

  return (
    <div className="card">
      <h2>Parameters</h2>

      <div className="group">
        <h3>Pillar weights</h3>
        <div className="weights">
          <NumberField
            label="Community"
            value={params.weights.community}
            step={0.5}
            onChange={(community) => set('weights', { community })}
          />
          <NumberField
            label="Holdings"
            value={params.weights.holdings}
            step={0.5}
            onChange={(holdings) => set('weights', { holdings })}
          />
          <NumberField
            label="Votes"
            value={params.weights.votes}
            step={0.5}
            onChange={(votes) => set('weights', { votes })}
          />
        </div>
        <div className="hint">
          Σw = {sumW} → {pct(params.weights.community)} / {pct(params.weights.holdings)} /{' '}
          {pct(params.weights.votes)}. A weight of 0 flags a pillar off.
        </div>
      </div>

      <div className="group">
        <h3>Holdings</h3>
        <Slider
          label="HOLD_REF"
          value={params.holdings.ref}
          min={100}
          max={100_000}
          step={100}
          onChange={(ref) => set('holdings', { ref })}
          format={(v) => v.toLocaleString()}
          hint="Time-weighted holding that scores 100."
        />
        <Slider
          label="Concavity p"
          value={params.holdings.concavity}
          min={0.3}
          max={1.0}
          step={0.05}
          onChange={(concavity) => set('holdings', { concavity })}
          format={(v) => v.toFixed(2)}
          hint={
            params.holdings.mode === 'log'
              ? 'Inactive while log mode is on.'
              : params.holdings.concavity === 0.5
                ? '0.50 = square root (proposal default)'
                : params.holdings.concavity >= 0.99
                  ? '1.00 = linear — pure plutocracy below the cap'
                  : `${params.holdings.concavity.toFixed(2)} — lower flattens whales harder`
          }
        />
        <Toggle
          label="Log mode (over-flattens; for comparison)"
          checked={params.holdings.mode === 'log'}
          onChange={(on) => set('holdings', { mode: on ? 'log' : 'power' })}
        />
        <Slider
          label="TWAB window T"
          value={params.holdings.windowDays}
          min={1}
          max={365}
          step={1}
          onChange={(windowDays) => set('holdings', { windowDays })}
          format={(v) => `${v}d`}
          hint="Longer windows punish last-minute accumulation harder."
        />
      </div>

      <div className="group">
        <h3>Snapshot participation</h3>
        <Slider
          label="Half-life H"
          value={params.votes.halfLifeDays}
          min={7}
          max={720}
          step={1}
          onChange={(halfLifeDays) => set('votes', { halfLifeDays })}
          format={(v) => `${v}d`}
          hint="Raising H flattens recency toward plain vote counting."
        />
        <Slider
          label="Proposal window N"
          value={params.votes.windowN}
          min={1}
          max={50}
          step={1}
          onChange={(windowN) => set('votes', { windowN })}
          format={(v) => `${v}`}
          hint="How many recent closed proposals count."
        />
      </div>

      <div className="group">
        <h3>Community</h3>
        <SelectField
          label="Normalization"
          value={params.community.mode}
          onChange={(mode) => set('community', { mode })}
          options={[
            { value: 'native', label: 'native (0–100 as returned)' },
            { value: 'minmax', label: 'min–max (over roster)' },
            { value: 'refcap', label: 'reference cap' },
          ]}
          hint={
            params.community.mode === 'native'
              ? 'HighSignal already returns 0–100 — the proposal default.'
              : params.community.mode === 'minmax'
                ? 'Stretches the roster across the full 0–100 range.'
                : '100 × min(1, score / refValue)'
          }
        />
        {params.community.mode === 'refcap' && (
          <Slider
            label="Reference value"
            value={params.community.refValue}
            min={1}
            max={100}
            step={1}
            onChange={(refValue) => set('community', { refValue })}
            format={(v) => v.toFixed(0)}
          />
        )}
      </div>

      <div className="group">
        <h3>Missing data</h3>
        <SelectField
          label="Delegate missing a live pillar"
          value={params.missingPolicy}
          onChange={(missingPolicy) => onChange({ ...params, missingPolicy })}
          options={[
            { value: 'zero', label: 'count as 0 (recommended)' },
            { value: 'exclude', label: 'exclude from average' },
          ]}
          hint={
            params.missingPolicy === 'zero'
              ? 'Missing data can never improve a rank.'
              : '⚠ Makes "no data" beat a measured low score — a delegate with no HighSignal profile outranks one scoring 8.'
          }
        />
        <div className="hint">
          A pillar with no data for <em>any</em> delegate is switched off for everyone regardless —
          the proposal&rsquo;s graceful degradation.
        </div>
      </div>

      <div className="group">
        <h3>Presets</h3>
        <PresetBar params={params} onImport={onChange} onReset={onReset} />
      </div>
    </div>
  );
}
