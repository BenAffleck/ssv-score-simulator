import { COHORT_LABELS, type Candidate, type Row } from '../../../scoring-core/index.js';
import { fmtScore, fmtTokens } from '../theme.js';
import type { Before, Context } from './Leaderboard.js';

interface Props {
  row: Row | null;
  ctx: Context;
  candidates: Map<string, Candidate>;
  /** Roster addresses per identity id. */
  members: Map<string, string[]>;
}

/** The selected address: why it is a candidate, its identity, inputs, and its seat vs production. */
export function DelegateCard({ row, ctx, candidates, members }: Props) {
  if (!row) return null;
  const meta = ctx.meta.get(row.address);
  const candidate = candidates.get(row.address);
  const identity = meta?.identity ?? row.address;
  const siblings = members.get(identity) ?? [row.address];
  const before: Before | undefined = ctx.before.get(row.address);
  const cohort = ctx.outcome.allocation?.members.get(row.address) ?? null;
  const power = ctx.outcome.allocation?.power.get(row.address) ?? 0;

  return (
    <div className="card">
      <div className="chart-head">
        <h2>{row.displayName}</h2>
        <span className="chart-note mono">{row.address}</span>
      </div>
      <table className="mini-table">
        <tbody>
          <tr>
            <td className="left">Candidate because</td>
            <td className="left">{candidate?.sources.length ? candidate.sources.join(', ') : '—'}</td>
          </tr>
          <tr>
            <td className="left">Handles</td>
            <td className="left">
              {[
                meta?.hsUsername && `HighSignal @${meta.hsUsername}`,
                candidate?.forumHandle && `forum ${candidate.forumHandle}`,
                candidate?.discordHandle && `Discord ${candidate.discordHandle}`,
                candidate?.ensName,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </td>
          </tr>
          <tr>
            <td className="left">Inputs</td>
            <td className="left">
              HighSignal {fmtScore(row.communityRaw, 0)}
              {row.hsRank !== null && ` (rank ${row.hsRank})`} · TWAB {fmtTokens(row.twab)}
              {row.twabDays !== null && ` over ${row.twabDays}d`} · voted {row.votedCount ?? 0} of {row.proposalCount ?? 0}
            </td>
          </tr>
          <tr>
            <td className="left">Seat</td>
            <td className="left">
              {cohort ? `${COHORT_LABELS[cohort]}, ${fmtTokens(power)}` : 'none'}
              {meta?.optedOut && ' — opted out'}
              {meta?.autoDelegator && ' — delegates to the auto-delegation pool'}
              {before && (
                <span className="dim">
                  {' '}
                  · production: {before.cohort ? `${COHORT_LABELS[before.cohort]}, ${fmtTokens(before.power)}` : 'none'}, rank{' '}
                  {before.rank ?? '—'}
                </span>
              )}
            </td>
          </tr>
          {siblings.length > 1 && (
            <tr>
              <td className="left">Identity {identity}</td>
              <td className="left mono">
                {siblings.map((a) => (
                  <div key={a}>
                    {a}
                    {a === row.address && <span className="handle"> this row</span>}
                    {ctx.outcome.allocation?.members.has(a) && <span className="handle"> holds the seat</span>}
                  </div>
                ))}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {siblings.length === 1 && (
        <div className="hint">
          An identity of one: no other roster address shares a HighSignal user with it, so it draws its own seat.
        </div>
      )}
    </div>
  );
}
