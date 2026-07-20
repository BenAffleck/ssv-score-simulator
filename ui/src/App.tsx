import { useMemo, useState } from 'react';
import {
  DEFAULT_PARAMS,
  clonePolicy,
  dateRange,
  indexDataset,
  round2,
  simulate,
  type LeaderboardRow,
  type ScoringParams,
} from '../../scoring-core/index.js';
import { Leaderboard } from './components/Leaderboard.js';
import { ParamPanel } from './components/ParamPanel.js';
import { PillarChart, ScoreChart } from './components/Charts.js';
import { colorFor, fmtScore } from './theme.js';
import { useDataset } from './useDataset.js';

/** Keep the time-series charts to ~90 points regardless of range length. */
const MAX_POINTS = 90;

export function App() {
  const state = useDataset();

  if (state.status === 'loading') return <div className="loading">Loading dataset…</div>;
  if (state.status === 'error') {
    return (
      <div className="error">
        <div>
          <strong>Could not load data/dataset.json</strong>
          <code>{state.message}</code>
          <code>Run `npm run collect` (live) or `npm run seed:demo` (offline sample), then reload.</code>
        </div>
      </div>
    );
  }
  return <Simulator dataset={state.dataset} />;
}

function Simulator({ dataset }: { dataset: import('../../scoring-core/index.js').Dataset }) {
  const [params, setParams] = useState<ScoringParams>(() => clonePolicy(DEFAULT_PARAMS));
  const [selected, setSelected] = useState<string | null>(null);

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
        for (const r of simulate(index, params, date)) {
          point[r.address.toLowerCase()] = r.score === null ? null : round2(r.score);
        }
        return point;
      }),
    [index, params, chartDates],
  );

  const selectedRow: LeaderboardRow | null =
    rows.find((r) => r.address === selected) ?? rows[0] ?? null;

  // Weighted contribution of each pillar: wᵢ·Sᵢ / Σw, so the stack sums to the score.
  const pillarData = useMemo(() => {
    if (!selectedRow) return [];
    const target = selectedRow.address.toLowerCase();
    return chartDates.map((date) => {
      const row = simulate(index, params, date).find((r) => r.address.toLowerCase() === target);
      const point: Record<string, string | number | null> = { date };
      let den = 0;
      for (const k of ['community', 'holdings', 'votes'] as const) {
        if (row && row.pillars[k] !== null && params.weights[k] > 0) den += params.weights[k];
      }
      for (const k of ['community', 'holdings', 'votes'] as const) {
        const s = row?.pillars[k] ?? null;
        point[k] = s === null || den <= 0 ? 0 : round2((params.weights[k] * s) / den);
      }
      return point;
    });
  }, [index, params, chartDates, selectedRow]);

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
    <div className="app">
      <header className="header">
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
      </header>

      <aside className="sidebar">
        <ParamPanel
          params={params}
          onChange={setParams}
          onReset={() => setParams(clonePolicy(DEFAULT_PARAMS))}
        />
      </aside>

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

        <Leaderboard
          rows={rows}
          colors={colors}
          selected={selectedRow?.address ?? null}
          onSelect={setSelected}
          params={params}
        />

        <div className="chart-grid">
          <ScoreChart
            data={scoreData}
            rows={rows}
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
