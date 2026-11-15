import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { COHORT_LABELS, type Allocation } from '../../../scoring-core/index.js';
import { COHORT_COLORS, fmtDelta, fmtTokens } from '../theme.js';

const AXIS = { stroke: '#64748b', fontSize: 11 };

interface Props {
  allocation: Allocation;
  /** Production's allocation at the same as-of, to compare against. */
  baseline: Allocation | null;
}

/** Each cohort's budget, seats and per-seat power, against production's. */
export function DelegationBreakdown({ allocation, baseline }: Props) {
  const data = allocation.cohorts.map((c) => ({ key: c.cohort, label: COHORT_LABELS[c.cohort], budget: Math.round(c.budget) }));
  const before = new Map(baseline?.cohorts.map((c) => [c.cohort, c]) ?? []);

  return (
    <div className="card">
      <div className="chart-head">
        <h2>Allocation</h2>
        <span className="chart-note">
          {fmtTokens(allocation.delegated)} pool ·{' '}
          {allocation.voided > 0 && (
            <>
              <span className="warn-text">{fmtTokens(allocation.voided)} voided (cap)</span> ·{' '}
            </>
          )}
          {fmtTokens(allocation.effective)} distributable · {fmtTokens(allocation.unallocated)} unallocated
        </span>
      </div>

      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" tick={AXIS} tickFormatter={(v) => fmtTokens(v)} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={AXIS} width={130} axisLine={false} tickLine={false} />
          <Bar dataKey="budget" radius={[0, 3, 3, 0]}>
            {data.map((d) => (
              <Cell key={d.key} fill={COHORT_COLORS[d.key]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <table className="mini-table">
        <thead>
          <tr>
            <th className="left">Cohort</th>
            <th>Share</th>
            <th>Budget</th>
            <th>Seats</th>
            <th>Per seat</th>
            <th>vs production</th>
            <th className="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {allocation.cohorts.map((c) => {
            const b = before.get(c.cohort);
            return (
              <tr key={c.cohort}>
                <td className="left">
                  <span className="cohort-badge" style={{ background: COHORT_COLORS[c.cohort] }} />
                  {COHORT_LABELS[c.cohort]}
                </td>
                <td>{c.pct}%</td>
                <td>{fmtTokens(c.budget)}</td>
                <td>
                  {c.memberCount}
                  {b && b.memberCount !== c.memberCount && <span className="delta"> ({fmtDelta(c.memberCount - b.memberCount, 0)})</span>}
                </td>
                <td>{fmtTokens(c.perMember)}</td>
                <td>{b && Math.abs(c.perMember - b.perMember) >= 0.5 ? <span className="delta">{fmtDelta(c.perMember - b.perMember, 0, true)}</span> : ""}</td>
                <td className={`left ${c.warning ? 'warn-text' : ''}`}>
                  {c.warning ? `below min (${c.minMembers})` : c.minMembers !== null ? 'ok' : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
