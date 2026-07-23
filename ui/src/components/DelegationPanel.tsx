import {
  COHORT_LABELS,
  type CohortKey,
  type DelegationConfig,
  type DelegationResult,
} from '../../../scoring-core/index.js';
import { COHORT_COLORS } from '../theme.js';
import { NumberField } from './Controls.js';
import { DelegationPresetBar } from './DelegationPresetBar.js';

interface Props {
  config: DelegationConfig;
  onChange: (next: DelegationConfig) => void;
  onImport: (next: DelegationConfig) => void;
  onReset: () => void;
  result: DelegationResult;
}

/** A compact numeric input for a table cell. */
function NumCell({ value, onChange, min = 0, title }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  title?: string;
}) {
  return (
    <input
      className="cell-num"
      type="number"
      min={min}
      value={value}
      title={title}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.max(min, n));
      }}
    />
  );
}

/**
 * Sidebar section driving the delegation impact simulation: the delegatable
 * lump sum and the cohort split/gating, laid out as an adjustable table so the
 * five cohorts read at a glance. Every setter makes a fresh object so the
 * leaderboard and breakdown recompute live, like the scoring parameters.
 */
export function DelegationPanel({ config, onChange, onImport, onReset, result }: Props) {
  type Group = 'ssvCommunity' | 'verifiedOperators' | 'professional' | 'grantRecipients' | 'ethCommunities';
  const set = <K extends Group>(key: K, patch: Partial<DelegationConfig[K]>) =>
    onChange({ ...config, [key]: { ...config[key], ...patch } });

  const sumPct =
    config.ssvCommunity.pct +
    config.verifiedOperators.pct +
    config.professional.pct +
    config.grantRecipients.pct +
    config.ethCommunities.pct;

  const gateOf = (cohort: CohortKey) => {
    switch (cohort) {
      case 'ssvCommunity':
        return (
          <NumCell
            value={config.ssvCommunity.scoreThreshold}
            onChange={(scoreThreshold) => set('ssvCommunity', { scoreThreshold })}
            title="SSV Community: include entities scoring above this"
          />
        );
      case 'verifiedOperators':
        return <NumCell value={config.verifiedOperators.minMembers} onChange={(minMembers) => set('verifiedOperators', { minMembers })} title="Minimum nominations" />;
      case 'professional':
        return <NumCell value={config.professional.minMembers} onChange={(minMembers) => set('professional', { minMembers })} title="Minimum nominations" />;
      case 'grantRecipients':
        return <NumCell value={config.grantRecipients.minMembers} onChange={(minMembers) => set('grantRecipients', { minMembers })} title="Minimum nominations" />;
      default:
        return <span className="dim">—</span>;
    }
  };

  const pctOf = (cohort: CohortKey): number =>
    (config[cohort as Group] as { pct: number }).pct;

  return (
    <div className="card">
      <h2>Delegation impact</h2>

      <div className="group">
        <h3>Delegatable pool</h3>
        <NumberField
          label="Total SSV / cSSV (auto-delegation)"
          value={config.totalDelegatable}
          step={1000}
          onChange={(totalDelegatable) => onChange({ ...config, totalDelegatable })}
        />
        <div className="hint">
          The lump sum delegated to/by the DAO, split across cohorts regardless of source.
        </div>
      </div>

      <div className="group">
        <h3>Cohort split</h3>
        <table className="cohort-table">
          <thead>
            <tr>
              <th className="left">Cohort</th>
              <th>Share %</th>
              <th>Min / thr.</th>
              <th>Members</th>
            </tr>
          </thead>
          <tbody>
            {result.cohorts.map((c) => (
              <tr key={c.cohort}>
                <td className="left">
                  <span className="cohort-badge" style={{ background: COHORT_COLORS[c.cohort as CohortKey] }} />
                  {COHORT_LABELS[c.cohort as CohortKey]}
                </td>
                <td>
                  <NumCell value={pctOf(c.cohort)} onChange={(pct) => set(c.cohort as Group, { pct })} title="Share of the pool" />
                </td>
                <td>{gateOf(c.cohort)}</td>
                <td className={c.warning ? 'warn-text' : ''}>{c.memberCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          Σ = {sumPct}%{' '}
          {sumPct === 100
            ? '— fully allocated.'
            : sumPct < 100
              ? `— ${100 - sumPct}% held in reserve.`
              : `— over-allocated by ${sumPct - 100}%.`}{' '}
          Per-member voting power. Assign entities from the leaderboard.
        </div>
      </div>

      {result.warnings.length > 0 && (
        <div className="warn-note">
          {result.warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div className="group">
        <h3>Delegation preset</h3>
        <DelegationPresetBar delegation={config} onImport={onImport} onReset={onReset} />
      </div>
    </div>
  );
}
