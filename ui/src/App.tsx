import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PARAMS,
  cloneDelegation,
  clonePolicy,
  computeDelegation,
  dateRange,
  indexDataset,
  parseDelegationPreset,
  round2,
  simulate,
  type DelegationConfig,
  type CohortKey,
  type IdentityRow,
  type LeaderboardRow,
  type ScoringParams,
} from '../../scoring-core/index.js';
import delegationDefault from '../../data/delegation-default.json';
import { loadDelegationConfig, saveDelegationConfig } from './configStore.js';
import { DatasetBadge, DatasetGate } from './components/DatasetImport.js';
import { DelegationBreakdown } from './components/DelegationBreakdown.js';
import { DelegationPanel } from './components/DelegationPanel.js';
import { IdentityCard } from './components/IdentityCard.js';
import {
  DEFAULT_FILTER,
  Leaderboard,
  filterRows,
  type LeaderboardFilter,
} from './components/Leaderboard.js';
import { ParamPanel } from './components/ParamPanel.js';
import { PillarChart, ScoreChart } from './components/Charts.js';
import { colorFor, fmtScore } from './theme.js';
import { useDataset, type DatasetSource } from './useDataset.js';

/** Keep the time-series charts to ~90 points regardless of range length. */
const MAX_POINTS = 90;

/** Resizable-sidebar bounds, in px. */
const SIDEBAR_MIN = 300;
const SIDEBAR_MAX = 680;

/**
 * The shipped default delegation setup, read from an exported-format preset
 * file (data/delegation-default.json) rather than hardcoded — first-time users
 * get the ratified cohort split and the guaranteed-delegation assignments.
 */
const SEED_DELEGATION = parseDelegationPreset(delegationDefault);

export function App() {
  const { state, importFile, reset } = useDataset();

  if (state.status === 'loading') return <div className="loading">Loading dataset…</div>;
  if (state.status === 'empty') return <DatasetGate importFile={importFile} notice={state.notice} />;

  return (
    <Simulator
      // Remount on a dataset swap: the scrubber position and selected delegate
      // are indices into the OLD dataset and mean nothing in the new one.
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
  dataset: import('../../scoring-core/index.js').Dataset;
  source: DatasetSource;
  importFile: (file: File) => Promise<void>;
  onReset: () => void;
}) {
  const [params, setParams] = useState<ScoringParams>(() => clonePolicy(DEFAULT_PARAMS));
  const [delegation, setDelegationState] = useState<DelegationConfig>(() =>
    cloneDelegation(SEED_DELEGATION),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeaderboardFilter>(DEFAULT_FILTER);

  // Sidebar width is resizable and collapsible; both persist across reloads.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('sidebarWidth'));
    return Number.isFinite(v) && v >= SIDEBAR_MIN ? Math.min(SIDEBAR_MAX, v) : 380;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === '1',
  );
  useEffect(() => {
    try {
      localStorage.setItem('sidebarWidth', String(sidebarWidth));
    } catch {
      /* storage blocked — width just won't persist */
    }
  }, [sidebarWidth]);
  useEffect(() => {
    try {
      localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  }, [sidebarCollapsed]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
  };

  // Hydrate the delegation config from IndexedDB once, then persist on change.
  useEffect(() => {
    let live = true;
    void loadDelegationConfig().then((stored) => {
      if (live && stored) setDelegationState(stored);
    });
    return () => {
      live = false;
    };
  }, []);

  const setDelegation = (next: DelegationConfig) => {
    setDelegationState(next);
    void saveDelegationConfig(next);
  };

  const assignCohort = (address: string, cohort: CohortKey | null) => {
    const key = address.toLowerCase();
    const assignments = { ...delegation.assignments };
    if (cohort) assignments[key] = cohort;
    else delete assignments[key];
    setDelegation({ ...delegation, assignments });
  };

  const index = useMemo(() => indexDataset(dataset), [dataset]);

  const allDates = useMemo(
    () => dateRange(dataset.dateRange.start, dataset.dateRange.end),
    [dataset.dateRange.start, dataset.dateRange.end],
  );

  // As-of defaults to the most recent collected day.
  const [asOfIndex, setAsOfIndex] = useState(allDates.length - 1);
  const asOf = allDates[Math.min(asOfIndex, allDates.length - 1)] ?? dataset.dateRange.end;

  // Every score below flows from these three memos — change a parameter and
  // the whole page recomputes in-browser, with no reload and no server call.
  const rows = useMemo(() => simulate(index, params, asOf), [index, params, asOf]);

  const delegationResult = useMemo(
    () => computeDelegation(rows, delegation, dataset.ethCommunities ?? []),
    [rows, delegation, dataset.ethCommunities],
  );

  const identityByAddress = useMemo(() => {
    const map = new Map<string, IdentityRow>();
    for (const id of dataset.identities ?? []) map.set(id.address.toLowerCase(), id);
    return map;
  }, [dataset.identities]);

  const rosterAddresses = useMemo(
    () => new Set(dataset.delegates.map((d) => d.address.toLowerCase())),
    [dataset.delegates],
  );

  // One filtered set drives both the leaderboard and the DelegateScore chart.
  const visibleRows = useMemo(
    () => filterRows(rows, filter, delegationResult),
    [rows, filter, delegationResult],
  );

  // The time-series charts run ~90 simulate() passes; deferring their inputs
  // lets the leaderboard (which uses live params) repaint instantly while the
  // charts catch up a frame later, so dragging a slider never stalls.
  const deferredParams = useDeferredValue(params);
  const deferredSelected = useDeferredValue(selected);
  // pillarData reads `rows` only to pick a fallback target delegate. `rows` is a
  // fresh array on every parameter change, so depending on it directly would run
  // the memo's ~90 simulate() passes on the *urgent* render and stall the
  // leaderboard. Deferring it keeps that work at the same low priority as the
  // rest of the chart, so the table repaints first.
  const deferredRows = useDeferredValue(rows);

  const chartDates = useMemo(() => {
    const step = Math.max(1, Math.ceil(allDates.length / MAX_POINTS));
    const sampled = allDates.filter((_, i) => i % step === 0);
    const last = allDates.at(-1);
    if (last && sampled.at(-1) !== last) sampled.push(last);
    return sampled;
  }, [allDates]);

  const scoreData = useMemo(
    () =>
      chartDates.map((date) => {
        const point: Record<string, string | number | null> = { date };
        for (const r of simulate(index, deferredParams, date)) {
          point[r.address.toLowerCase()] = r.score === null ? null : round2(r.score);
        }
        return point;
      }),
    [index, deferredParams, chartDates],
  );

  const selectedRow: LeaderboardRow | null =
    rows.find((r) => r.address === selected) ?? rows[0] ?? null;

  // Weighted contribution of each pillar: wᵢ·Sᵢ / Σw, so the stack sums to the score.
  const pillarData = useMemo(() => {
    const target =
      deferredRows.find((r) => r.address === deferredSelected)?.address.toLowerCase() ??
      deferredRows[0]?.address.toLowerCase();
    if (!target) return [];
    return chartDates.map((date) => {
      const row = simulate(index, deferredParams, date).find((r) => r.address.toLowerCase() === target);
      const point: Record<string, string | number | null> = { date };
      let den = 0;
      for (const k of ['community', 'holdings', 'votes'] as const) {
        if (row && row.pillars[k] !== null && deferredParams.weights[k] > 0) den += deferredParams.weights[k];
      }
      for (const k of ['community', 'holdings', 'votes'] as const) {
        const s = row?.pillars[k] ?? null;
        point[k] = s === null || den <= 0 ? 0 : round2((deferredParams.weights[k] * s) / den);
      }
      return point;
    });
  }, [index, deferredParams, chartDates, deferredSelected, deferredRows]);

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    dataset.delegates.forEach((d, i) => map.set(d.address, colorFor(i)));
    return map;
  }, [dataset.delegates]);

  // Surfaced because a backfill shorter than T is otherwise invisible and
  // would quietly understate every delegate's holdings.
  const twabDays = Math.max(0, ...rows.map((r) => r.raw.twabDays));
  const twabTruncated = twabDays > 0 && twabDays < params.holdings.windowDays ? twabDays : null;

  const scored = rows.filter((r) => r.score !== null);
  const avg = scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null;

  return (
    <div
      className="app"
      style={{
        gridTemplateColumns: sidebarCollapsed ? '0 minmax(0, 1fr)' : `${sidebarWidth}px minmax(0, 1fr)`,
      }}
    >
      <header className="header">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((c) => !c)}
          title={sidebarCollapsed ? 'Show parameters panel' : 'Hide parameters panel'}
        >
          {sidebarCollapsed ? '»' : '«'}
        </button>
        <h1>Delegate Score Simulator</h1>
        <span className="sub">{dataset.space}</span>
        <span className="pill">{dataset.delegates.length} delegates</span>
        <span className="pill">
          {dataset.dateRange.start} → {dataset.dateRange.end}
        </span>
        <span className="pill">{dataset.proposals.length} proposals</span>
        <span style={{ marginLeft: 'auto' }} className="sub">
          collected {dataset.generatedAt.slice(0, 10)}
        </span>
        <DatasetBadge
          dataset={dataset}
          source={source}
          importFile={importFile}
          onReset={onReset}
        />
      </header>

      {!sidebarCollapsed && (
        <aside className="sidebar">
          <ParamPanel
            params={params}
            onChange={setParams}
            onReset={() => setParams(clonePolicy(DEFAULT_PARAMS))}
          />
          <DelegationPanel
            config={delegation}
            onChange={setDelegation}
            onImport={setDelegation}
            onReset={() => setDelegation(cloneDelegation(SEED_DELEGATION))}
            result={delegationResult}
          />
          <div
            className="sidebar-resizer"
            onMouseDown={startResize}
            title="Drag to resize"
            role="separator"
            aria-orientation="vertical"
          />
        </aside>
      )}

      <main className="main">
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
            Scores use only data up to this date — balances, votes and HighSignal observations
            after it are ignored.
          </div>
          {twabTruncated !== null && (
            <div className="warn-note">
              TWAB window is {params.holdings.windowDays}d but only {twabTruncated}d of balance
              history has been collected — holdings are averaged over {twabTruncated}d. Collect a
              longer backfill before reading holdings calibration from this.
            </div>
          )}
        </div>

        <div className="card">
          <div className="stat-row">
            <div className="stat">
              <div className="k">Top delegate</div>
              <div className="v">{rows[0]?.displayName ?? '—'}</div>
            </div>
            <div className="stat">
              <div className="k">Top score</div>
              <div className="v">{fmtScore(rows[0]?.score ?? null)}</div>
            </div>
            <div className="stat">
              <div className="k">Roster average</div>
              <div className="v">{fmtScore(avg)}</div>
            </div>
            <div className="stat">
              <div className="k">Proposals in window</div>
              <div className="v">{rows[0]?.raw.proposalCount ?? 0}</div>
            </div>
          </div>
        </div>

        <DelegationBreakdown result={delegationResult} totalDelegatable={delegation.totalDelegatable} />

        <Leaderboard
          rows={visibleRows}
          totalCount={rows.length}
          colors={colors}
          selected={selectedRow?.address ?? null}
          onSelect={setSelected}
          params={params}
          delegation={delegationResult}
          assignments={delegation.assignments}
          onAssign={assignCohort}
          filter={filter}
          onFilterChange={setFilter}
          identities={identityByAddress}
        />

        <IdentityCard
          row={selectedRow}
          identity={selectedRow ? identityByAddress.get(selectedRow.address.toLowerCase()) : undefined}
          rosterAddresses={rosterAddresses}
        />

        <div className="chart-grid">
          <ScoreChart
            data={scoreData}
            rows={visibleRows}
            colors={colors}
            asOf={asOf}
            selected={selectedRow?.address ?? null}
            onSelect={setSelected}
          />
          <PillarChart data={pillarData} delegate={selectedRow} asOf={asOf} />
        </div>
      </main>
    </div>
  );
}
