import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import {
  COHORT_LABELS,
  type CohortKey,
  type DelegationResult,
} from '../../../scoring-core/index.js';
import { COHORT_COLORS, fmtTokens } from '../theme.js';

const AXIS = { stroke: '#64748b', fontSize: 11 };

interface Props {
  result: DelegationResult;
  totalDelegatable: number;
}

/**
 * Breakdown of delegation power by cohort: budget, member count, per-member
 * power and min-member status, alongside a bar of each cohort's budget. Makes
 * the source of every entity's power auditable at a glance.
 */
export function DelegationBreakdown({ result, totalDelegatable }: Props) {
  const data = result.cohorts.map((c) => ({
    key: c.cohort,
    label: COHORT_LABELS[c.cohort as CohortKey],
    budget: Math.round(c.budget),
  }));

  return (
    <div className="card">
      <div className="chart-head">
        <h2>Delegation breakdown</h2>
        <span className="chart-note">
          {fmtTokens(totalDelegatable)} delegatable · {fmtTokens(result.unallocated)} unallocated
        </span>
      </div>

      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" tick={AXIS} tickFormatter={(v) => fmtTokens(v)} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={AXIS} width={120} axisLine={false} tickLine={false} />
          <Bar dataKey="budget" radius={[0, 3, 3, 0]}>
            {data.map((d) => (
              <Cell key={d.key} fill={COHORT_COLORS[d.key as CohortKey]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <table className="mini-table">
        <thead>
          <tr>
            <th className="left">Cohort</th>
            <th>Share</th>
            <th>Voting Power</th>
            <th>Members</th>
            <th>Per member</th>
            <th className="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {result.cohorts.map((c) => (
            <tr key={c.cohort}>
              <td className="left">
                <span className="cohort-badge" style={{ background: COHORT_COLORS[c.cohort as CohortKey] }} />
                {COHORT_LABELS[c.cohort as CohortKey]}
              </td>
              <td>{c.pct}%</td>
              <td>{fmtTokens(c.budget)}</td>
              <td>{c.memberCount}</td>
              <td>{fmtTokens(c.perMember)}</td>
              <td className={`left ${c.warning ? 'warn-text' : ''}`}>
                {c.warning ? `below min (${c.minMembers})` : c.minMembers ? 'ok' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
