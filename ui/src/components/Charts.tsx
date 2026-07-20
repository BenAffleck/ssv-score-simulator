import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LeaderboardRow } from '../../../scoring-core/index.js';
import { PILLAR_COLORS, PILLAR_LABELS, fmtScore } from '../theme.js';

const AXIS = { stroke: '#64748b', fontSize: 11 };
const GRID = '#26303e';

const shortDate = (d: string): string => d.slice(5).replace('-', '/');

interface TooltipEntry {
  name: string;
  value: number | null;
  color: string;
}

function ChartTooltip({ active, label, payload, suffix = '' }: {
  active?: boolean;
  label?: string;
  payload?: Array<{ name?: string; value?: number | null; color?: string; stroke?: string; fill?: string }>;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  const entries: TooltipEntry[] = payload
    .filter((p) => p.value !== null && p.value !== undefined)
    .map((p) => ({ name: String(p.name ?? ''), value: p.value as number, color: p.color ?? p.stroke ?? p.fill ?? '#888' }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <div className="tooltip">
      <div className="t-date">{label}</div>
      {entries.map((e) => (
        <div className="t-row" key={e.name}>
          <span style={{ color: e.color }}>{e.name}</span>
          <span>{fmtScore(e.value)}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ScoreChartProps {
  data: Array<Record<string, string | number | null>>;
  rows: LeaderboardRow[];
  colors: Map<string, string>;
  asOf: string;
  selected: string | null;
  onSelect: (address: string) => void;
}

/** DelegateScore over time, one line per delegate. */
export function ScoreChart({ data, rows, colors, asOf, selected, onSelect }: ScoreChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggle = (address: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(address) ? next.delete(address) : next.add(address);
      return next;
    });

  return (
    <div className="card">
      <div className="chart-head">
        <h2>DelegateScore over time</h2>
        <span className="chart-note">dashed line = as-of date</span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={40} />
          <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine x={asOf} stroke="#8d9bb0" strokeDasharray="4 4" />
          {rows.map((r) => {
            if (hidden.has(r.address)) return null;
            const isSel = selected === r.address;
            return (
              <Line
                key={r.address}
                type="monotone"
                dataKey={r.address.toLowerCase()}
                name={r.displayName}
                stroke={colors.get(r.address)}
                strokeWidth={isSel ? 2.6 : 1.4}
                strokeOpacity={selected && !isSel ? 0.35 : 1}
                dot={false}
                activeDot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <div className="legend">
        {rows.map((r) => (
          <span
            key={r.address}
            className={`legend-item ${hidden.has(r.address) ? 'off' : ''}`}
            onClick={() => toggle(r.address)}
            onDoubleClick={() => onSelect(r.address)}
            title="Click to hide/show · double-click to select"
          >
            <span className="swatch" style={{ background: colors.get(r.address) }} />
            {r.displayName}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PillarChartProps {
  data: Array<Record<string, string | number | null>>;
  delegate: LeaderboardRow | null;
  asOf: string;
}

/**
 * Pillar breakdown for the selected delegate: each band is that pillar's
 * *weighted contribution* (wᵢ·Sᵢ / Σw), so the stack height is exactly the
 * DelegateScore.
 */
export function PillarChart({ data, delegate, asOf }: PillarChartProps) {
  return (
    <div className="card">
      <div className="chart-head">
        <h2>Pillar breakdown</h2>
        <span className="chart-note">{delegate ? delegate.displayName : 'select a delegate'}</span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={40} />
          <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine x={asOf} stroke="#8d9bb0" strokeDasharray="4 4" />
          {(['votes', 'holdings', 'community'] as const).map((pillar) => (
            <Area
              key={pillar}
              type="monotone"
              dataKey={pillar}
              name={PILLAR_LABELS[pillar]}
              stackId="pillars"
              stroke={PILLAR_COLORS[pillar]}
              fill={PILLAR_COLORS[pillar]}
              fillOpacity={0.42}
              strokeWidth={1.2}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      <div className="legend">
        {(['community', 'holdings', 'votes'] as const).map((pillar) => (
          <span className="legend-item" key={pillar}>
            <span className="swatch" style={{ background: PILLAR_COLORS[pillar] }} />
            {PILLAR_LABELS[pillar]}
          </span>
        ))}
        <span className="chart-note">stack height = DelegateScore (weighted contributions)</span>
      </div>
    </div>
  );
}
