import { memo, useEffect, useMemo, useState } from 'react';
import {
  COHORT_KEYS,
  COHORT_LABELS,
  type CohortKey,
  type DelegationResult,
  type IdentityRow,
  type LeaderboardRow,
  type ScoringParams,
} from '../../../scoring-core/index.js';
import { COHORT_COLORS, PILLAR_COLORS, fmtScore, fmtTokens } from '../theme.js';

type SortKey = 'score' | 'community' | 'holdings' | 'votes' | 'twab' | 'power' | 'name';

/** Selectable rows-per-page for the leaderboard. */
export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** A leaderboard source: a cohort that can land on the grid, or "none". */
export type FilterSource = CohortKey | 'none';

export const FILTER_SOURCES: FilterSource[] = [
  'ssvCommunity',
  'verifiedOperators',
  'professional',
  'grantRecipients',
  'ethCommunities',
  'none',
];

export interface LeaderboardFilter {
  sources: Set<FilterSource>;
  minPower: number;
  hideUnscored: boolean;
  /** Fuzzy text query, matched across every metadata field of a row. */
  query: string;
}

export const DEFAULT_FILTER: LeaderboardFilter = {
  sources: new Set(FILTER_SOURCES),
  minPower: 0,
  hideUnscored: false,
  query: '',
};

/**
 * Fuzzy match: every whitespace-separated term must appear (as a substring) in
 * the row's combined metadata — name, forum handle, HighSignal handle, address.
 */
function matchesQuery(r: LeaderboardRow, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${r.displayName} ${r.forumHandle} ${r.raw.hsUsername ?? ''} ${r.address}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/**
 * The shared leaderboard filter — applied once in App so the same visible set
 * drives both the table and the DelegateScore chart.
 */
export function filterRows(
  rows: LeaderboardRow[],
  filter: LeaderboardFilter,
  delegation: DelegationResult,
): LeaderboardRow[] {
  return rows.filter((r) => {
    if (filter.hideUnscored && r.score === null) return false;
    if (!matchesQuery(r, filter.query)) return false;
    const entity = delegation.perEntity.get(r.address.toLowerCase());
    const cohort: FilterSource = entity?.cohort ?? 'none';
    if (!filter.sources.has(cohort)) return false;
    if ((entity?.power ?? 0) < filter.minPower) return false;
    return true;
  });
}

interface Props {
  /** Already filtered by App (so the chart and table stay in sync). */
  rows: LeaderboardRow[];
  totalCount: number;
  colors: Map<string, string>;
  selected: string | null;
  onSelect: (address: string) => void;
  params: ScoringParams;
  delegation: DelegationResult;
  assignments: Record<string, CohortKey>;
  onAssign: (address: string, cohort: CohortKey | null) => void;
  filter: LeaderboardFilter;
  onFilterChange: (next: LeaderboardFilter) => void;
  /** Extra eth addresses linked per delegate, keyed by lowercased address. */
  identities: Map<string, IdentityRow>;
}

export function Leaderboard({
  rows,
  totalCount,
  colors,
  selected,
  onSelect,
  params,
  delegation,
  assignments,
  onAssign,
  filter,
  onFilterChange,
  identities,
}: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 });
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [page, setPage] = useState(0);

  const powerOf = (addr: string) => delegation.perEntity.get(addr.toLowerCase())?.power ?? 0;
  const cohortOf = (addr: string): FilterSource =>
    delegation.perEntity.get(addr.toLowerCase())?.cohort ?? 'none';

  // Sorting is O(n log n) over every filtered row; memoizing keeps a mere
  // selection or hover from re-sorting the whole roster each render.
  const sorted = useMemo(() => {
    const powerAt = (addr: string) => delegation.perEntity.get(addr.toLowerCase())?.power ?? 0;
    return [...rows].sort((a, b) => {
      const pick = (r: LeaderboardRow): number | string => {
        switch (sort.key) {
          case 'name': return r.displayName.toLowerCase();
          case 'twab': return r.raw.twab ?? -1;
          case 'score': return r.score ?? -1;
          case 'power': return powerAt(r.address);
          default: return r.pillars[sort.key] ?? -1;
        }
      };
      const [x, y] = [pick(a), pick(b)];
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x).localeCompare(String(y)) * sort.dir;
      }
      return (x - y) * sort.dir;
    });
  }, [rows, sort, delegation]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  // A shrinking result set (new filter, smaller page size) can strand the view
  // past the last page; clamp back into range without an extra render pass.
  const clampedPage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (page !== clampedPage) setPage(clampedPage);
  }, [page, clampedPage]);

  const start = clampedPage * pageSize;
  const pageRows = useMemo(
    () => sorted.slice(start, start + pageSize),
    [sorted, start, pageSize],
  );

  const toggle = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' ? 1 : -1 }));
    setPage(0); // re-sorting should surface the new top, not strand you mid-list
  };

  const toggleSource = (src: FilterSource) => {
    const next = new Set(filter.sources);
    if (next.has(src)) next.delete(src);
    else next.add(src);
    onFilterChange({ ...filter, sources: next });
  };

  const th = (key: SortKey, label: string, className = '') => (
    <th
      className={`${className} ${sort.key === key ? 'sorted' : ''}`.trim()}
      onClick={() => toggle(key)}
      title="Click to sort"
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div className="card">
      <div className="chart-head">
        <h2>Leaderboard</h2>
        <span className="chart-note">
          {rows.length} of {totalCount} · click a row to inspect · set a cohort per row
        </span>
      </div>

      <div className="filter-bar">
        <input
          className="leaderboard-search"
          type="search"
          placeholder="Search name, handle, address…"
          value={filter.query}
          onChange={(e) => onFilterChange({ ...filter, query: e.target.value })}
        />
        <div className="filter-sources">
          {FILTER_SOURCES.map((src) => (
            <label key={src} className={`source-chip ${filter.sources.has(src) ? 'on' : ''}`}>
              <input type="checkbox" checked={filter.sources.has(src)} onChange={() => toggleSource(src)} />
              {src !== 'none' && (
                <span className="cohort-badge" style={{ background: COHORT_COLORS[src] }} />
              )}
              {src === 'none' ? 'Unassigned' : COHORT_LABELS[src]}
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
            <input
              type="checkbox"
              checked={filter.hideUnscored}
              onChange={(e) => onFilterChange({ ...filter, hideUnscored: e.target.checked })}
            />
            Hide unscored
          </label>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th className="left rank">#</th>
            {th('name', 'Delegate', 'left')}
            {th('score', 'Score')}
            {th('community', 'Community')}
            {th('holdings', 'Holdings')}
            {th('votes', 'Votes')}
            {th('twab', 'TWAB')}
            {th('power', 'Power')}
            <th className="left">Cohort</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r, i) => {
            const cohort = cohortOf(r.address);
            const power = powerOf(r.address);
            return (
              <tr
                key={r.address}
                className={selected === r.address ? 'selected' : ''}
                onClick={() => onSelect(r.address)}
              >
                <td className="left rank">{start + i + 1}</td>
                <td className="left">
                  <div className="name">
                    <span className="swatch" style={{ background: colors.get(r.address) }} />
                    <span>
                      {r.displayName}
                      {r.raw.hsUsername && <span className="handle"> @{r.raw.hsUsername}</span>}
                      {(() => {
                        const linked = identities.get(r.address.toLowerCase())?.linkedAddresses ?? [];
                        return linked.length > 0 ? (
                          <span
                            className="link-chip"
                            title={`Linked eth addresses:\n${r.address}\n${linked.join('\n')}`}
                          >
                            🔗{linked.length}
                          </span>
                        ) : null;
                      })()}
                    </span>
                  </div>
                </td>
                <td className="score-cell" style={{ color: r.score === null ? undefined : scoreColor(r.score) }}>
                  {fmtScore(r.score)}
                </td>
                <PillarCell value={r.pillars.community} color={PILLAR_COLORS.community} weight={params.weights.community} missing={r.missing.community} />
                <PillarCell value={r.pillars.holdings} color={PILLAR_COLORS.holdings} weight={params.weights.holdings} missing={r.missing.holdings} />
                <PillarCell value={r.pillars.votes} color={PILLAR_COLORS.votes} weight={params.weights.votes} missing={r.missing.votes} />
                <td>{fmtTokens(r.raw.twab)}</td>
                <td className={power > 0 ? 'power-cell' : 'null'}>{power > 0 ? fmtTokens(power) : '—'}</td>
                <td className="left cohort-cell" onClick={(e) => e.stopPropagation()}>
                  {cohort !== 'none' && (
                    <span className="cohort-badge" style={{ background: COHORT_COLORS[cohort] }} title={COHORT_LABELS[cohort]} />
                  )}
                  <select
                    value={assignments[r.address.toLowerCase()] ?? ''}
                    onChange={(e) => onAssign(r.address, (e.target.value || null) as CohortKey | null)}
                    title="Pin to a cohort, or leave on auto assigned"
                  >
                    <option value="">— auto assigned —</option>
                    {COHORT_KEYS.map((c) => (
                      <option key={c} value={c}>
                        {COHORT_LABELS[c]}
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
            {sorted.length === 0
              ? '0'
              : `${start + 1}–${Math.min(start + pageSize, sorted.length)}`}{' '}
            of {sorted.length}
          </span>
          <button onClick={() => setPage(0)} disabled={clampedPage === 0} title="First page">
            «
          </button>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={clampedPage === 0}
            title="Previous page"
          >
            ‹
          </button>
          <span className="page-of">
            Page {clampedPage + 1} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={clampedPage >= pageCount - 1}
            title="Next page"
          >
            ›
          </button>
          <button
            onClick={() => setPage(pageCount - 1)}
            disabled={clampedPage >= pageCount - 1}
            title="Last page"
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}

const PillarCell = memo(function PillarCell({
  value,
  color,
  weight,
  missing,
}: {
  value: number | null;
  color: string;
  weight: number;
  missing: boolean;
}) {
  const off = weight <= 0;
  // An imputed value is shown, not hidden — the score uses it, so the table
  // must say so rather than implying the delegate was measured.
  const title = off
    ? 'Weight is 0 — this pillar is excluded'
    : missing && value !== null
      ? 'No data for this delegate — counted as 0'
      : missing
        ? 'No data for any delegate — pillar excluded for everyone'
        : undefined;

  return (
    <td className={value === null ? 'null' : ''} style={off ? { opacity: 0.35 } : undefined} title={title}>
      <span className="bar-wrap" style={missing ? { opacity: 0.55 } : undefined}>
        {fmtScore(value)}
        {missing && value !== null && <span className="imputed"> n/a</span>}
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
  if (score >= 75) return '#3fcf8e';
  if (score >= 50) return '#e6ecf4';
  if (score >= 25) return '#f5c451';
  return '#f07a9c';
}
