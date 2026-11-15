import { memo, useEffect, useMemo, useState } from 'react';
import {
  COHORT_KEYS,
  COHORT_LABELS,
  NOMINATED_COHORTS,
  type CohortKey,
  type NominatedCohort,
  type Outcome,
  type Params,
  type Row,
} from '../../../scoring-core/index.js';
import { COHORT_COLORS, PILLAR_COLORS, fmtDelta, fmtScore, fmtTokens } from '../theme.js';

type SortKey = 'rank' | 'score' | 'dScore' | 'community' | 'holdings' | 'votes' | 'twab' | 'power' | 'dPower' | 'name';

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type FilterSource = CohortKey | 'none';
export const FILTER_SOURCES: FilterSource[] = [...COHORT_KEYS, 'none'];

export interface LeaderboardFilter {
  sources: Set<FilterSource>;
  minPower: number;
  hideUnscored: boolean;
  /** Only rows whose rank, cohort or power differ from production's. */
  changedOnly: boolean;
  query: string;
}

export const DEFAULT_FILTER: LeaderboardFilter = {
  sources: new Set(FILTER_SOURCES),
  minPower: 0,
  hideUnscored: false,
  changedOnly: false,
  query: '',
};

/** What a row looked like under production's config at the same as-of. */
export interface Before {
  rank: number | null;
  score: number | null;
  cohort: CohortKey | null;
  power: number;
}

export interface RowMeta {
  identity: string;
  /** Other roster addresses of the same identity. */
  siblings: number;
  hsUsername: string | null;
  forumHandle: string | null;
  ensName: string | null;
  optedOut: boolean;
  autoDelegator: boolean;
  ethCommunity: boolean;
}

export interface Context {
  outcome: Outcome;
  before: Map<string, Before>;
  meta: Map<string, RowMeta>;
  nominations: Map<string, NominatedCohort>;
}

const cohortOf = (ctx: Context, address: string): CohortKey | null =>
  ctx.outcome.allocation?.members.get(address) ?? null;
const powerOf = (ctx: Context, address: string): number => ctx.outcome.allocation?.power.get(address) ?? 0;

export function changed(ctx: Context, r: Row): boolean {
  const b = ctx.before.get(r.address);
  if (!b) return true;
  return b.rank !== r.rank || b.cohort !== cohortOf(ctx, r.address) || Math.abs(b.power - powerOf(ctx, r.address)) >= 0.5;
}

function matchesQuery(r: Row, meta: RowMeta | undefined, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [r.displayName, r.address, meta?.hsUsername, meta?.forumHandle, meta?.ensName, meta?.identity]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** Applied once in App, so the table and the chart show the same rows. */
export function filterRows(rows: Row[], filter: LeaderboardFilter, ctx: Context): Row[] {
  return rows.filter((r) => {
    if (filter.hideUnscored && r.score === null) return false;
    if (!matchesQuery(r, ctx.meta.get(r.address), filter.query)) return false;
    if (!filter.sources.has(cohortOf(ctx, r.address) ?? 'none')) return false;
    if (powerOf(ctx, r.address) < filter.minPower) return false;
    if (filter.changedOnly && !changed(ctx, r)) return false;
    return true;
  });
}

interface Props {
  rows: Row[];
  totalCount: number;
  colors: Map<string, string>;
  selected: string | null;
  onSelect: (address: string) => void;
  params: Params;
  ctx: Context;
  onNominate: (address: string, cohort: NominatedCohort | null) => void;
  filter: LeaderboardFilter;
  onFilterChange: (next: LeaderboardFilter) => void;
}

export function Leaderboard({ rows, totalCount, colors, selected, onSelect, params, ctx, onNominate, filter, onFilterChange }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const pick = (r: Row): number | string => {
      const b = ctx.before.get(r.address);
      switch (sort.key) {
        case 'name': return r.displayName.toLowerCase();
        case 'rank': return r.rank ?? Number.MAX_SAFE_INTEGER;
        case 'twab': return r.twab ?? -1;
        case 'score': return r.score ?? -1;
        case 'dScore': return (r.score ?? 0) - (b?.score ?? 0);
        case 'power': return powerOf(ctx, r.address);
        case 'dPower': return powerOf(ctx, r.address) - (b?.power ?? 0);
        default: return r[sort.key] ?? -1;
      }
    };
    return [...rows].sort((a, b) => {
      const [x, y] = [pick(a), pick(b)];
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * sort.dir;
      return (x - y) * sort.dir || (a.rank ?? 1e9) - (b.rank ?? 1e9);
    });
  }, [rows, sort, ctx]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (page !== clampedPage) setPage(clampedPage);
  }, [page, clampedPage]);
  const start = clampedPage * pageSize;
  const pageRows = useMemo(() => sorted.slice(start, start + pageSize), [sorted, start, pageSize]);

  const toggle = (key: SortKey) => {
    const ascending = key === 'name' || key === 'rank';
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: ascending ? 1 : -1 }));
    setPage(0);
  };
  const toggleSource = (src: FilterSource) => {
    const next = new Set(filter.sources);
    if (next.has(src)) next.delete(src);
    else next.add(src);
    onFilterChange({ ...filter, sources: next });
  };
  const th = (key: SortKey, label: string, className = '', title = 'Click to sort') => (
    <th className={`${className} ${sort.key === key ? 'sorted' : ''}`.trim()} onClick={() => toggle(key)} title={title}>
      {label}
      {sort.key === key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div className="card">
      <div className="chart-head">
        <h2>Leaderboard</h2>
        <span className="chart-note">
          {rows.length} of {totalCount} · Δ = this scenario vs production at the same as-of · click a row to inspect
        </span>
      </div>

      <div className="filter-bar">
        <input
          className="leaderboard-search"
          type="search"
          placeholder="Search name, handle, ENS, address…"
          value={filter.query}
          onChange={(e) => onFilterChange({ ...filter, query: e.target.value })}
        />
        <div className="filter-sources">
          {FILTER_SOURCES.map((src) => (
            <label key={src} className={`source-chip ${filter.sources.has(src) ? 'on' : ''}`}>
              <input type="checkbox" checked={filter.sources.has(src)} onChange={() => toggleSource(src)} />
              {src !== 'none' && <span className="cohort-badge" style={{ background: COHORT_COLORS[src] }} />}
              {src === 'none' ? 'No seat' : COHORT_LABELS[src]}
            </label>
          ))}
        </div>
        <div className="filter-tools">
          <label className="dust">
            Min power
            <input
              type="number"
              min={0}
              step={100}
              value={filter.minPower}
              onChange={(e) => onFilterChange({ ...filter, minPower: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={filter.changedOnly} onChange={(e) => onFilterChange({ ...filter, changedOnly: e.target.checked })} />
            Changed vs production
          </label>
          <label className="toggle">
            <input type="checkbox" checked={filter.hideUnscored} onChange={(e) => onFilterChange({ ...filter, hideUnscored: e.target.checked })} />
            Hide unscored
          </label>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            {th('rank', '#', 'left rank')}
            {th('name', 'Delegate', 'left')}
            {th('score', 'Score')}
            {th('dScore', 'Δ', '', 'Score change vs production')}
            {th('community', 'Community')}
            {th('holdings', 'Holdings')}
            {th('votes', 'Votes')}
            {th('twab', 'TWAB')}
            {th('power', 'Power')}
            {th('dPower', 'Δ', '', 'Power change vs production')}
            <th className="left">Cohort</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => {
            const cohort = cohortOf(ctx, r.address);
            const power = powerOf(ctx, r.address);
            const b = ctx.before.get(r.address);
            const meta = ctx.meta.get(r.address);
            const nominated = ctx.nominations.get(r.address) ?? '';
            const dRank = b && b.rank !== null && r.rank !== null ? b.rank - r.rank : 0;
            return (
              <tr key={r.address} className={selected === r.address ? 'selected' : ''} onClick={() => onSelect(r.address)}>
                <td className="left rank">
                  {r.rank ?? '—'}
                  {dRank !== 0 && <span className={`delta ${dRank > 0 ? 'up' : 'down'}`}> {dRank > 0 ? '▲' : '▼'}{Math.abs(dRank)}</span>}
                </td>
                <td className="left">
                  <div className="name">
                    <span className="swatch" style={{ background: colors.get(r.address) }} />
                    <span>
                      {r.displayName}
                      {meta?.hsUsername && <span className="handle"> @{meta.hsUsername}</span>}
                      {meta && meta.siblings > 0 && (
                        <span className="link-chip" title={`One identity (${meta.identity}) with ${meta.siblings + 1} roster addresses — one seat between them`}>
                          🔗{meta.siblings + 1}
                        </span>
                      )}
                      {meta?.optedOut && <span className="flag-chip warn" title="Opted out of allocation: scored, ranked, no seat">opted out</span>}
                      {meta?.autoDelegator && <span className="flag-chip warn" title="Delegates to the auto-delegation pool: scored, ranked, no seat">auto-delegator</span>}
                    </span>
                  </div>
                </td>
                <td className="score-cell" style={{ color: r.score === null ? undefined : scoreColor(r.score) }}>
                  {fmtScore(r.score)}
                </td>
                <td><Delta value={b ? (r.score ?? 0) - (b.score ?? 0) : null} /></td>
                <PillarCell value={r.community} color={PILLAR_COLORS.community} weight={params.weights.community} missing={r.missing.community} />
                <PillarCell value={r.holdings} color={PILLAR_COLORS.holdings} weight={params.weights.holdings} missing={r.missing.holdings} />
                <PillarCell value={r.votes} color={PILLAR_COLORS.votes} weight={params.weights.votes} missing={r.missing.votes} />
                <td>{fmtTokens(r.twab)}</td>
                <td className={power > 0 ? 'power-cell' : 'null'}>{power > 0 ? fmtTokens(power) : '—'}</td>
                <td><Delta value={b ? power - b.power : null} tokens /></td>
                <td className="left cohort-cell" onClick={(e) => e.stopPropagation()}>
                  {cohort && <span className="cohort-badge" style={{ background: COHORT_COLORS[cohort] }} title={COHORT_LABELS[cohort]} />}
                  <select
                    value={nominated}
                    onChange={(e) => onNominate(r.address, (e.target.value || null) as NominatedCohort | null)}
                    title={cohort ? `Seat in ${COHORT_LABELS[cohort]}` : 'No seat'}
                  >
                    <option value="">{cohort && !nominated ? COHORT_LABELS[cohort] : '— automatic —'}</option>
                    {NOMINATED_COHORTS.map((c) => (
                      <option key={c} value={c}>
                        Nominate: {COHORT_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="pager">
        <label className="page-size">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as PageSize);
              setPage(0);
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="page-nav">
          <span className="page-range">
            {sorted.length === 0 ? '0' : `${start + 1}–${Math.min(start + pageSize, sorted.length)}`} of {sorted.length}
          </span>
          <button onClick={() => setPage(0)} disabled={clampedPage === 0} title="First page">«</button>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={clampedPage === 0} title="Previous page">‹</button>
          <span className="page-of">Page {clampedPage + 1} / {pageCount}</span>
          <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={clampedPage >= pageCount - 1} title="Next page">›</button>
          <button onClick={() => setPage(pageCount - 1)} disabled={clampedPage >= pageCount - 1} title="Last page">»</button>
        </div>
      </div>
    </div>
  );
}

function Delta({ value, tokens = false }: { value: number | null; tokens?: boolean }) {
  if (value === null) return <span className="delta">new</span>;
  const text = fmtDelta(value, 1, tokens);
  if (text === '±0') return null;
  return <span className={`delta ${value > 0 ? 'up' : 'down'}`}>{text}</span>;
}

const PillarCell = memo(function PillarCell({ value, color, weight, missing }: { value: number | null; color: string; weight: number; missing: boolean }) {
  const off = weight <= 0;
  const title = off
    ? 'Weight is 0 — shown, not counted'
    : missing
      ? 'No data for this address — counted as 0'
      : value === null
        ? 'No data for anyone — pillar excluded for everyone'
        : undefined;
  return (
    <td className={value === null ? 'null' : ''} style={off ? { opacity: 0.35 } : undefined} title={title}>
      <span className="bar-wrap" style={missing ? { opacity: 0.55 } : undefined}>
        {fmtScore(value)}
        {missing && <span className="imputed"> n/a</span>}
        {value !== null && (
          <span className="bar">
            <span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
          </span>
        )}
      </span>
    </td>
  );
});

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--accent)';
  if (score >= 50) return 'var(--foreground)';
  if (score >= 25) return 'var(--warning)';
  return 'var(--danger)';
}
