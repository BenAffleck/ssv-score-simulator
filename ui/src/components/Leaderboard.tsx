import { useState } from 'react';
import type { LeaderboardRow, ScoringParams } from '../../../scoring-core/index.js';
import { PILLAR_COLORS, fmtScore, fmtTokens } from '../theme.js';

type SortKey = 'score' | 'community' | 'holdings' | 'votes' | 'twab' | 'name';

interface Props {
  rows: LeaderboardRow[];
  colors: Map<string, string>;
  selected: string | null;
  onSelect: (address: string) => void;
  params: ScoringParams;
}

export function Leaderboard({ rows, colors, selected, onSelect, params }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 });

  const sorted = [...rows].sort((a, b) => {
    const pick = (r: LeaderboardRow): number | string => {
      switch (sort.key) {
        case 'name': return r.displayName.toLowerCase();
        case 'twab': return r.raw.twab ?? -1;
        case 'score': return r.score ?? -1;
        default: return r.pillars[sort.key] ?? -1;
      }
    };
    const [x, y] = [pick(a), pick(b)];
    if (typeof x === 'string' || typeof y === 'string') {
      return String(x).localeCompare(String(y)) * sort.dir;
    }
    return (x - y) * sort.dir;
  });

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' ? 1 : -1 }));

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
          {rows.length} delegates · ranked by DelegateScore · click a row to inspect
        </span>
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
            <th>Voted</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={r.address}
              className={selected === r.address ? 'selected' : ''}
              onClick={() => onSelect(r.address)}
            >
              <td className="left rank">{i + 1}</td>
              <td className="left">
                <div className="name">
                  <span className="swatch" style={{ background: colors.get(r.address) }} />
                  <span>
                    {r.displayName}
                    {r.raw.hsUsername && <span className="handle"> @{r.raw.hsUsername}</span>}
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
              <td className={r.raw.proposalCount === 0 ? 'null' : ''}>
                {r.raw.proposalCount === 0 ? '—' : `${r.raw.votedCount}/${r.raw.proposalCount}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PillarCell({
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
}

function scoreColor(score: number): string {
  if (score >= 75) return '#3fcf8e';
  if (score >= 50) return '#e6ecf4';
  if (score >= 25) return '#f5c451';
  return '#f07a9c';
}
