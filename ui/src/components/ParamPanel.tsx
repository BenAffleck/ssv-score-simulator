import { parseParams, type Params } from '../../../scoring-core/index.js';
import { ConfigFileBar } from './ConfigFileBar.js';
import { NumberField, Slider } from './Controls.js';

interface Props {
  params: Params;
  production: Params;
  onChange: (next: Params) => void;
}

/** Scoring levers — exactly the fields of production's `config/params.json`. */
export function ParamPanel({ params, production, onChange }: Props) {
  type GroupKey = keyof Params;
  const set = <K extends GroupKey>(key: K, patch: Partial<Params[K]>) =>
    onChange({ ...params, [key]: { ...params[key], ...patch } });

  const sumW = params.weights.community + params.weights.holdings + params.weights.votes;
  const pct = (w: number) => (sumW > 0 ? `${Math.round((100 * w) / sumW)}%` : '—');
  const was = (now: number, then: number, fmt: (v: number) => string = String) =>
    now === then ? undefined : `production: ${fmt(then)}`;

  return (
    <div className="card">
      <h2>Scoring</h2>

      <div className="group">
        <h3>Pillar weights</h3>
        <div className="weights">
          <NumberField label="Community" value={params.weights.community} step={0.5} onChange={(community) => set('weights', { community })} />
          <NumberField label="Holdings" value={params.weights.holdings} step={0.5} onChange={(holdings) => set('weights', { holdings })} />
          <NumberField label="Votes" value={params.weights.votes} step={0.5} onChange={(votes) => set('weights', { votes })} />
        </div>
        <div className="hint">
          Σw = {sumW} → {pct(params.weights.community)} / {pct(params.weights.holdings)} / {pct(params.weights.votes)}.
          A weight of 0 leaves a pillar shown but not counted.
        </div>
      </div>

      <div className="group">
        <h3>Community</h3>
        <Slider
          label="Reference score"
          value={params.community.ref}
          min={1}
          max={100}
          step={1}
          onChange={(ref) => set('community', { ref })}
          hint={was(params.community.ref, production.community.ref) ?? '100 × clamp(HighSignal / ref, 0, 1). 100 is HighSignal’s native scale.'}
        />
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
          hint={was(params.holdings.ref, production.holdings.ref, (v) => v.toLocaleString()) ?? 'Time-weighted holding that scores 100.'}
        />
        <Slider
          label="Concavity p"
          value={params.holdings.concavity}
          min={0.1}
          max={1.0}
          step={0.05}
          onChange={(concavity) => set('holdings', { concavity })}
          format={(v) => v.toFixed(2)}
          hint={
            was(params.holdings.concavity, production.holdings.concavity) ??
            (params.holdings.concavity >= 0.99 ? '1.00 = linear — pure plutocracy below the cap' : 'Lower flattens whales harder; 0.50 = square root.')
          }
        />
        <Slider
          label="TWAB window T"
          value={params.holdings.windowDays}
          min={1}
          max={365}
          step={1}
          onChange={(windowDays) => set('holdings', { windowDays })}
          format={(v) => `${v}d`}
          hint={was(params.holdings.windowDays, production.holdings.windowDays) ?? 'Intersected with the days production has collected.'}
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
          hint={was(params.votes.halfLifeDays, production.votes.halfLifeDays) ?? 'Raising H flattens recency toward plain vote counting.'}
        />
        <Slider
          label="Proposal window N"
          value={params.votes.windowN}
          min={1}
          max={50}
          step={1}
          onChange={(windowN) => set('votes', { windowN })}
          hint={was(params.votes.windowN, production.votes.windowN) ?? 'How many recent closed proposals count. Flagged proposals never do.'}
        />
      </div>

      <div className="group">
        <h3>config/params.json</h3>
        <ConfigFileBar
          filename="params.json"
          text={() => JSON.stringify(params, null, 2)}
          onImport={(content) => onChange(parseParams(content))}
          onReset={() => onChange(production)}
        />
      </div>
    </div>
  );
}
