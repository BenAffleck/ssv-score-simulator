import {
  COHORT_LABELS,
  nominationsCsv,
  parseDelegation,
  parseNominations,
  type CohortKey,
  type Delegation,
  type Nomination,
  type Outcome,
  type Scenario,
} from '../../../scoring-core/index.js';
import { COHORT_COLORS, fmtTokens } from '../theme.js';
import { ConfigFileBar } from './ConfigFileBar.js';
import { NumberField, Toggle } from './Controls.js';

interface Props {
  scenario: Scenario;
  production: Scenario;
  onChange: (next: Scenario) => void;
  outcome: Outcome;
  /** The pool production read for the as-of. */
  readPool: number;
  /** Source kind → candidates with it. */
  sourceCounts: Array<[string, number]>;
}

function NumCell({ value, onChange, title }: { value: number; onChange: (v: number) => void; title?: string }) {
  return (
    <input
      className="cell-num"
      type="number"
      min={0}
      value={value}
      title={title}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.max(0, n));
      }}
    />
  );
}

const SOURCE_LABELS: Record<string, string> = {
  grandfathered: 'Grandfathered (Karma era)',
  snapshot_voter: 'Snapshot voters',
  snapshot_follower: 'Snapshot followers',
  highsignal_ssv: 'HighSignal SSV users',
  highsignal_eth: 'HighSignal ETH communities',
  nomination: 'Nominated',
};

/**
 * Allocation levers: the pool, production's `config/delegation.json`, the
 * nominations and which roster sources count.
 */
export function DelegationPanel({ scenario, production, onChange, outcome, readPool, sourceCounts }: Props) {
  const { delegation } = scenario;
  const allocation = outcome.allocation;
  const setDelegation = (next: Delegation) => onChange({ ...scenario, delegation: next });
  const setCohort = (cohort: CohortKey, patch: { pct?: number; minMembers?: number }) =>
    setDelegation({
      ...delegation,
      cohorts: { ...delegation.cohorts, [cohort]: { ...delegation.cohorts[cohort], ...patch } },
    });

  const sumPct = Object.values(delegation.cohorts).reduce((s, c) => s + c.pct, 0);
  const selectedSources = new Set(scenario.sources ?? sourceCounts.map(([s]) => s));
  const toggleSource = (source: string) => {
    const next = new Set(selectedSources);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    const all = sourceCounts.every(([s]) => next.has(s));
    onChange({ ...scenario, sources: all ? null : [...next] });
  };
  const nominationsChanged = nominationKey(scenario.nominations) !== nominationKey(production.nominations);

  return (
    <div className="card">
      <h2>Allocation</h2>

      <div className="group">
        <h3>Pool</h3>
        <Toggle
          label={`Use the Safe's power production read (${fmtTokens(readPool)})`}
          checked={scenario.pool === null}
          onChange={(on) => onChange({ ...scenario, pool: on ? null : Math.round(readPool) })}
        />
        {scenario.pool !== null && (
          <NumberField
            label="Simulated pool (SSV-eq)"
            value={scenario.pool}
            step={10_000}
            onChange={(pool) => onChange({ ...scenario, pool })}
          />
        )}
        <div className="hint">
          The pool is not configured in production: each run reads the auto-delegation Safe&rsquo;s
          delegatable power at the close of the as-of.
        </div>

        <Toggle
          label="Cap distributable power"
          checked={delegation.cap !== null}
          onChange={(on) => setDelegation({ ...delegation, cap: on ? (production.delegation.cap ?? 500_000) : null })}
        />
        {delegation.cap !== null && (
          <NumberField
            label="Cap (SSV-eq)"
            value={delegation.cap}
            step={10_000}
            onChange={(cap) => setDelegation({ ...delegation, cap })}
          />
        )}
        {allocation && (
          <div className="hint">
            {delegation.cap === null ? (
              <>Uncapped — every delegated token is distributed.</>
            ) : allocation.voided > 0 ? (
              <>
                Distributing {fmtTokens(allocation.effective)}; {fmtTokens(allocation.voided)} above the
                cap is <strong>voided</strong>.
              </>
            ) : (
              <>
                Not binding: {fmtTokens(allocation.delegated)} is {fmtPct(allocation.delegated / delegation.cap)} of
                the {fmtTokens(delegation.cap)} cap.
              </>
            )}
          </div>
        )}
      </div>

      <div className="group">
        <h3>Cohorts</h3>
        <NumberField
          label="SSV Community: score above"
          value={delegation.scoreThreshold}
          step={1}
          onChange={(scoreThreshold) => setDelegation({ ...delegation, scoreThreshold })}
        />
        <table className="cohort-table">
          <thead>
            <tr>
              <th className="left">Cohort</th>
              <th>Share %</th>
              <th>Min</th>
              <th>Seats</th>
            </tr>
          </thead>
          <tbody>
            {(allocation?.cohorts ?? []).map((c) => (
              <tr key={c.cohort}>
                <td className="left">
                  <span className="cohort-badge" style={{ background: COHORT_COLORS[c.cohort] }} />
                  {COHORT_LABELS[c.cohort]}
                </td>
                <td>
                  <NumCell value={delegation.cohorts[c.cohort].pct} onChange={(pct) => setCohort(c.cohort, { pct })} title="Share of the effective pool" />
                </td>
                <td>
                  {c.minMembers === null ? (
                    <span className="dim">—</span>
                  ) : (
                    <NumCell value={c.minMembers} onChange={(minMembers) => setCohort(c.cohort, { minMembers })} title="Minimum nominations" />
                  )}
                </td>
                <td className={c.warning ? 'warn-text' : ''}>{c.memberCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint">
          Σ = {sumPct}%{' '}
          {sumPct === 100 ? '— fully allocated.' : sumPct < 100 ? `— ${100 - sumPct}% unallocated reserve.` : `— over-allocated by ${sumPct - 100}%.`}{' '}
          One seat per identity; its highest-scoring qualifying address holds it.
        </div>
        <div style={{ marginTop: 10 }}>
          <ConfigFileBar
            filename="delegation.json"
            text={() => JSON.stringify(delegation, null, 2)}
            onImport={(content) => setDelegation(parseDelegation(content))}
            onReset={() => setDelegation(production.delegation)}
          />
        </div>
      </div>

      <div className="group">
        <h3>Nominations</h3>
        <div className="hint" style={{ marginTop: 0 }}>
          {scenario.nominations.length} nominated addresses{nominationsChanged ? ' (changed from production)' : ''}.
          Nominate from the leaderboard&rsquo;s cohort column. Opted-out addresses and auto-delegators
          draw no seat whatever their nomination.
        </div>
        <div style={{ marginTop: 8 }}>
          <ConfigFileBar
            filename="nominations.csv"
            text={() => nominationsCsv(scenario.nominations)}
            onImport={(content) => onChange({ ...scenario, nominations: parseNominations(content) })}
            onReset={() => onChange({ ...scenario, nominations: production.nominations })}
          />
        </div>
      </div>

      <div className="group">
        <h3>Roster</h3>
        {sourceCounts.length === 0 ? (
          <div className="hint" style={{ marginTop: 0 }}>This dataset does not say why each address is a candidate.</div>
        ) : (
          <>
            {sourceCounts.map(([source, count]) => (
              <Toggle
                key={source}
                label={`${SOURCE_LABELS[source] ?? source} (${count})`}
                checked={selectedSources.has(source)}
                onChange={() => toggleSource(source)}
              />
            ))}
            <div className="hint">
              Production scores every candidate it has discovered. Narrowing the roster is an
              eligibility change, which goes back to the DAO.
            </div>
          </>
        )}
      </div>

      {outcome.error && <div className="warn-note">✖ {outcome.error}. Production would abort this run.</div>}
      {allocation && allocation.warnings.length > 0 && (
        <div className="warn-note">
          {allocation.warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const fmtPct = (x: number) => `${(100 * x).toFixed(0)}%`;

export function nominationKey(nominations: readonly Nomination[]): string {
  return nominations
    .map((n) => `${n.address}:${n.cohort}`)
    .sort()
    .join(',');
}
