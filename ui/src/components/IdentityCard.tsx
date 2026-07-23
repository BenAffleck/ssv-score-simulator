import type { IdentityRow, LeaderboardRow } from '../../../scoring-core/index.js';

interface Props {
  row: LeaderboardRow | null;
  identity: IdentityRow | undefined;
  /** Lowercased addresses present in the roster (delegates.csv). */
  rosterAddresses: Set<string>;
}

/**
 * Every eth address linked to the selected delegate's identity, each tagged
 * with where it is actually known from — the roster CSV, HighSignal, or both.
 * A person's addresses collapse to one delegate, so this is the place to see
 * the full on-chain footprint behind that single row.
 */
export function IdentityCard({ row, identity, rosterAddresses }: Props) {
  if (!row) return null;
  const primary = row.address.toLowerCase();

  // The identity's HighSignal addresses: the full published set when there are
  // linked extras, otherwise just this delegate's own matched address.
  const hs = new Set<string>();
  if (identity) {
    hs.add(identity.address.toLowerCase());
    for (const a of identity.linkedAddresses) hs.add(a.toLowerCase());
  } else if (row.raw.hsUsername) {
    hs.add(primary);
  }

  const addresses = [...new Set<string>([primary, ...hs])];

  return (
    <div className="card">
      <div className="chart-head">
        <h2>Linked addresses</h2>
        <span className="chart-note">
          {row.displayName}
          {row.raw.hsUsername ? ` · @${row.raw.hsUsername}` : ''}
        </span>
      </div>
      <table className="mini-table addr-table">
        <tbody>
          {addresses.map((a) => {
            const inRoster = rosterAddresses.has(a);
            const inHs = hs.has(a);
            return (
              <tr key={a}>
                <td className="left mono">
                  {a}
                  {a === primary && <span className="handle"> primary</span>}
                </td>
                <td className="left">
                  {inRoster && <span className="src-tag src-csv">delegates.csv</span>}
                  {inHs && <span className="src-tag src-hs">HighSignal</span>}
                  {!inRoster && !inHs && <span className="dim">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {addresses.length === 1 && (
        <div className="hint">
          {row.raw.hsUsername
            ? 'No additional HighSignal-linked addresses published.'
            : 'No HighSignal handle — only the roster address is known.'}
        </div>
      )}
    </div>
  );
}
