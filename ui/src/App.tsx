import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  dateRange,
  delegationEqual,
  evaluate,
  paramsEqual,
  poolAt,
  prepare,
  productionScenario,
  rosterFilter,
  round2,
  runScenario,
  sourceKind,
  type Dataset,
  type NominatedCohort,
  type Row,
  type Scenario,
} from '../../scoring-core/index.js';
import { loadScenario, saveScenario } from './configStore.js';
import { PillarChart, ScoreChart } from './components/Charts.js';
import { DatasetBadge, DatasetGate } from './components/DatasetImport.js';
import { DelegateCard } from './components/DelegateCard.js';
import { DelegationBreakdown } from './components/DelegationBreakdown.js';
import { DelegationPanel, nominationKey } from './components/DelegationPanel.js';
import {
  DEFAULT_FILTER,
  Leaderboard,
  changed,
  filterRows,
  type Before,
  type Context,
  type LeaderboardFilter,
  type RowMeta,
} from './components/Leaderboard.js';
import { ParamPanel } from './components/ParamPanel.js';
import { colorFor, fmtScore, fmtTokens } from './theme.js';
import { useDataset, type DatasetSource } from './useDataset.js';

/** Keep the time-series charts to ~90 points regardless of range length. */
const MAX_POINTS = 90;
/** Lines on the score chart: the top visible rows, plus the selected one. */
const CHART_LINES = 12;
const SIDEBAR_MIN = 300;
const SIDEBAR_MAX = 680;

export function App() {
  const { state, importFile, reset } = useDataset();
  if (state.status === 'loading') return <div className="loading">Loading dataset…</div>;
  if (state.status === 'empty') return <DatasetGate importFile={importFile} notice={state.notice} />;
  return (
    <Simulator
      key={`${state.source.kind}:${state.dataset.generatedAt}`}
      dataset={state.dataset}
      source={state.source}
      importFile={importFile}
      onReset={() => void reset()}
    />
  );
}

function Simulator({
  dataset,
  source,
  importFile,
  onReset,
}: {
  dataset: Dataset;
  source: DatasetSource;
  importFile: (file: File) => Promise<void>;
  onReset: () => void;
}) {
  const production = useMemo(() => productionScenario(dataset), [dataset]);
  const [scenario, setScenarioState] = useState<Scenario>(production);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeaderboardFilter>(DEFAULT_FILTER);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const v = Number(safeGet('sidebarWidth'));
    return Number.isFinite(v) && v >= SIDEBAR_MIN ? Math.min(SIDEBAR_MAX, v) : 400;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => safeGet('sidebarCollapsed') === '1');
  useEffect(() => safeSet('sidebarWidth', String(sidebarWidth)), [sidebarWidth]);
  useEffect(() => safeSet('sidebarCollapsed', sidebarCollapsed ? '1' : '0'), [sidebarCollapsed]);

  useEffect(() => {
    let live = true;
    void loadScenario(dataset.origin).then((stored) => {
      if (live && stored) setScenarioState(stored);
    });
    return () => {
      live = false;
    };
  }, [dataset.origin]);
  const setScenario = (next: Scenario) => {
    setScenarioState(next);
    void saveScenario(dataset.origin, next);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) =>
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
  };

  const prepared = useMemo(() => prepare(dataset), [dataset]);
  const allDates = useMemo(() => dateRange(dataset.dateRange.start, dataset.dateRange.end), [dataset.dateRange]);
  // Opens on production's run as-of, so the first screen is the published leaderboard.
  const [asOfIndex, setAsOfIndex] = useState(() => {
    const i = dataset.production ? allDates.indexOf(dataset.production.asOf) : -1;
    return i >= 0 ? i : allDates.length - 1;
  });
  const asOf = allDates[Math.min(asOfIndex, allDates.length - 1)] ?? dataset.dateRange.end;

  const outcome = useMemo(() => runScenario(prepared, scenario, asOf), [prepared, scenario, asOf]);
  const baseline = useMemo(() => runScenario(prepared, production, asOf), [prepared, production, asOf]);

  const before = useMemo(() => {
    const map = new Map<string, Before>();
    for (const r of baseline.rows) {
      map.set(r.address, {
        rank: r.rank,
        score: r.score,
        cohort: baseline.allocation?.members.get(r.address) ?? null,
        power: baseline.allocation?.power.get(r.address) ?? 0,
      });
    }
    return map;
  }, [baseline]);

  const ctx: Context = useMemo(() => {
    const meta = new Map<string, RowMeta>();
    const counts = new Map<string, number>();
    for (const identity of outcome.identities.values()) counts.set(identity.id, (counts.get(identity.id) ?? 0) + 1);
    const optedOut = new Set(dataset.optedOut);
    const auto = new Set(dataset.safeDelegators);
    const eth = new Set(dataset.ethCommunity);
    for (const c of dataset.roster) {
      const identity = outcome.identities.get(c.address);
      if (!identity) continue;
      meta.set(c.address, {
        identity: identity.id,
        siblings: (counts.get(identity.id) ?? 1) - 1,
        hsUsername: identity.hsUsername,
        forumHandle: c.forumHandle,
        ensName: c.ensName,
        optedOut: optedOut.has(c.address),
        autoDelegator: auto.has(c.address),
        ethCommunity: eth.has(c.address),
      });
    }
    return {
      outcome,
      before,
      meta,
      nominations: new Map(scenario.nominations.map((n) => [n.address, n.cohort])),
    };
  }, [outcome, before, dataset, scenario.nominations]);

  const members = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [address, identity] of outcome.identities) map.set(identity.id, [...(map.get(identity.id) ?? []), address]);
    return map;
  }, [outcome.identities]);
  const candidates = useMemo(() => new Map(dataset.roster.map((c) => [c.address, c])), [dataset.roster]);
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of dataset.roster) for (const kind of new Set(c.sources.map(sourceKind))) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [dataset.roster]);

  const visibleRows = useMemo(() => filterRows(outcome.rows, filter, ctx), [outcome.rows, filter, ctx]);
  const changedCount = useMemo(() => outcome.rows.filter((r) => changed(ctx, r)).length, [outcome.rows, ctx]);

  const parity = useMemo(() => {
    const run = dataset.production;
    if (!run || run.rows.length === 0 || asOf !== run.asOf) return null;
    const ours = new Map(baseline.rows.map((r) => [r.address, r]));
    let matching = 0;
    for (const p of run.rows) {
      const r = ours.get(p.address);
      const seat = baseline.allocation?.members.get(p.address) ?? null;
      if (r && r.rank === p.rank && near(r.score, p.score) && seat === p.cohort && near(baseline.allocation?.power.get(p.address) ?? 0, p.power)) matching++;
    }
    return { matching, total: run.rows.length, runId: run.runId };
  }, [dataset.production, baseline, asOf]);

  const edits = describeEdits(scenario, production);

  const toggleNomination = (address: string, cohort: NominatedCohort | null) => {
    const rest = scenario.nominations.filter((n) => n.address !== address);
    setScenario({ ...scenario, nominations: cohort ? [...rest, { address, cohort }] : rest });
  };

  // Charts recompute the scenario at ~90 dates; deferring keeps the table responsive while dragging.
  const deferredParams = useDeferredValue(scenario.params);
  const deferredSources = useDeferredValue(scenario.sources);
  const deferredSelected = useDeferredValue(selected);
  const chartDates = useMemo(() => {
    const step = Math.max(1, Math.ceil(allDates.length / MAX_POINTS));
    const sampled = allDates.filter((_, i) => i % step === 0);
    const last = allDates.at(-1);
    if (last && sampled.at(-1) !== last) sampled.push(last);
    return sampled;
  }, [allDates]);
  const series = useMemo(() => {
    const include = rosterFilter(prepared, deferredSources);
    return chartDates.map((date) => ({ date, rows: evaluate(prepared, deferredParams, date, include) }));
  }, [prepared, deferredParams, deferredSources, chartDates]);

  const selectedRow: Row | null = outcome.rows.find((r) => r.address === selected) ?? visibleRows[0] ?? null;
  const chartRows = useMemo(() => {
    const top = visibleRows.slice(0, CHART_LINES);
    const sel = visibleRows.find((r) => r.address === deferredSelected);
    return sel && !top.includes(sel) ? [...top, sel] : top;
  }, [visibleRows, deferredSelected]);
  const scoreData = useMemo(
    () =>
      series.map(({ date, rows }) => {
        const point: Record<string, string | number | null> = { date };
        const wanted = new Set(chartRows.map((r) => r.address));
        for (const r of rows) if (wanted.has(r.address)) point[r.address] = r.score === null ? null : round2(r.score);
        return point;
      }),
    [series, chartRows],
  );
  const pillarData = useMemo(() => {
    const target = selectedRow?.address;
    if (!target) return [];
    const w = deferredParams.weights;
    return series.map(({ date, rows }) => {
      const r = rows.find((x) => x.address === target);
      const point: Record<string, string | number | null> = { date };
      let den = 0;
      for (const k of ['community', 'holdings', 'votes'] as const) if (r && r[k] !== null && w[k] > 0) den += w[k];
      for (const k of ['community', 'holdings', 'votes'] as const) {
        const s = r?.[k] ?? null;
        point[k] = s === null || den <= 0 ? 0 : round2((w[k] * s) / den);
      }
      return point;
    });
  }, [series, selectedRow?.address, deferredParams.weights]);

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    dataset.roster.forEach((c, i) => map.set(c.address, colorFor(i)));
    return map;
  }, [dataset.roster]);

  const twabDays = Math.max(0, ...outcome.rows.map((r) => r.twabDays ?? 0));
  const twabTruncated = twabDays > 0 && twabDays < scenario.params.holdings.windowDays ? twabDays : null;
  const seats = outcome.allocation?.cohorts.reduce((s, c) => s + c.memberCount, 0) ?? 0;

  return (
    <div className="app" style={{ gridTemplateColumns: sidebarCollapsed ? '0 minmax(0, 1fr)' : `${sidebarWidth}px minmax(0, 1fr)` }}>
      <header className="header">
        <button className="sidebar-toggle" onClick={() => setSidebarCollapsed((c) => !c)} title={sidebarCollapsed ? 'Show levers' : 'Hide levers'}>
          {sidebarCollapsed ? '»' : '«'}
        </button>
        <h1>Delegate Score Simulator</h1>
        <span className="sub">{dataset.space}</span>
        <span className="pill">{dataset.roster.length} candidates</span>
        <span className="pill">{dataset.proposals.length} proposals</span>
        {dataset.production && (
          <span className="pill" title={`production code ${dataset.production.codeVersion}`}>
            production run #{dataset.production.runId} · {dataset.production.asOf}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }} className="sub">
          imported {dataset.generatedAt.slice(0, 10)}
        </span>
        <DatasetBadge dataset={dataset} source={source} importFile={importFile} onReset={onReset} />
      </header>

      {!sidebarCollapsed && (
        <aside className="sidebar">
          <ParamPanel params={scenario.params} production={production.params} onChange={(params) => setScenario({ ...scenario, params })} />
          <DelegationPanel
            scenario={scenario}
            production={production}
            onChange={setScenario}
            outcome={outcome}
            readPool={poolAt(dataset, asOf)}
            sourceCounts={sourceCounts}
          />
          <div className="sidebar-resizer" onMouseDown={startResize} title="Drag to resize" role="separator" aria-orientation="vertical" />
        </aside>
      )}

      <main className="main">
        <div className="card">
          <div className="scenario-bar">
            <strong>{edits.length === 0 ? 'Production' : 'Scenario'}</strong>
            <span className="changes">{edits.length === 0 ? 'every lever at production’s value' : edits.join(' · ')}</span>
            {edits.length > 0 && (
              <>
                <span className="changes">
                  → {changedCount} of {outcome.rows.length} rows change rank, seat or power
                </span>
                <button onClick={() => setScenario(production)}>Reset to production</button>
              </>
            )}
            {parity && edits.length === 0 && (
              <span className={`parity ${parity.matching === parity.total ? 'ok' : 'off'}`} style={{ marginLeft: 'auto' }}>
                {parity.matching === parity.total
                  ? `✔ reproduces production run #${parity.runId} (${parity.total} rows)`
                  : `⚠ ${parity.total - parity.matching} of ${parity.total} rows differ from production run #${parity.runId}`}
              </span>
            )}
          </div>
        </div>

        <div className="card">
          <div className="scrubber">
            <div>
              <div className="stat">
                <div className="k">As of</div>
              </div>
              <div className="date">{asOf}</div>
            </div>
            <span className="ends">{allDates[0]}</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, allDates.length - 1)}
              step={1}
              value={Math.min(asOfIndex, allDates.length - 1)}
              onChange={(e) => setAsOfIndex(Number(e.target.value))}
            />
            <span className="ends">{allDates.at(-1)}</span>
            <button onClick={() => setAsOfIndex(allDates.length - 1)}>Latest</button>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            Scored as production would freeze this day: only balances, votes and HighSignal
            observations up to its end. Opt-outs, auto-delegators, ETH-community members and
            nominations are those of the imported run.
          </div>
          {twabTruncated !== null && (
            <div className="warn-note">
              TWAB window is {scenario.params.holdings.windowDays}d but production had only {twabTruncated}d of balances by
              this date — holdings are averaged over {twabTruncated}d, as production would.
            </div>
          )}
        </div>

        <div className="card">
          <div className="stat-row">
            <Stat k="Top delegate" v={outcome.rows[0]?.displayName ?? '—'} />
            <Stat k="Top score" v={fmtScore(outcome.rows[0]?.score ?? null)} />
            <Stat k="Seats" v={String(seats)} />
            <Stat k="Pool" v={fmtTokens(outcome.pool)} />
            <Stat k="Proposals in window" v={String(outcome.rows[0]?.proposalCount ?? 0)} />
          </div>
        </div>

        {outcome.allocation ? (
          <DelegationBreakdown allocation={outcome.allocation} baseline={baseline.allocation} />
        ) : (
          <div className="card warn-note">✖ {outcome.error}. Production would abort this run — fix the nominations.</div>
        )}

        <Leaderboard
          rows={visibleRows}
          totalCount={outcome.rows.length}
          colors={colors}
          selected={selectedRow?.address ?? null}
          onSelect={setSelected}
          params={scenario.params}
          ctx={ctx}
          onNominate={toggleNomination}
          filter={filter}
          onFilterChange={setFilter}
        />

        <DelegateCard row={selectedRow} ctx={ctx} candidates={candidates} members={members} />

        <div className="chart-grid">
          <ScoreChart data={scoreData} rows={chartRows} colors={colors} asOf={asOf} selected={selectedRow?.address ?? null} onSelect={setSelected} />
          <PillarChart data={pillarData} delegate={selectedRow} asOf={asOf} />
        </div>
      </main>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

/** One phrase per lever group that differs from production. */
function describeEdits(s: Scenario, p: Scenario): string[] {
  const edits: string[] = [];
  if (!paramsEqual(s.params, p.params)) edits.push('scoring params');
  if (s.delegation.cap !== p.delegation.cap) edits.push(`cap ${s.delegation.cap === null ? 'off' : fmtTokens(s.delegation.cap)}`);
  if (s.delegation.scoreThreshold !== p.delegation.scoreThreshold) edits.push(`threshold ${s.delegation.scoreThreshold}`);
  if (!delegationEqual({ ...s.delegation, cap: null, scoreThreshold: 0 }, { ...p.delegation, cap: null, scoreThreshold: 0 })) {
    edits.push('cohort shares');
  }
  if (s.pool !== null) edits.push(`pool ${fmtTokens(s.pool)}`);
  if (nominationKey(s.nominations) !== nominationKey(p.nominations)) edits.push('nominations');
  if (s.sources !== null) edits.push('roster sources');
  return edits;
}

function near(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}
