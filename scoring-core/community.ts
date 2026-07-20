/**
 * Pillar 1 — Community Contribution (HighSignal).
 * HighSignal's overall score is already a 0–100 index, so 'native' is the
 * proposal default; the other modes exist to recalibrate it empirically.
 */
import type { ScoringParams } from './types.js';

export interface CommunityContext {
  /** Min/max raw score across the roster as of the simulated date ('minmax' mode). */
  min: number;
  max: number;
}

export function normalizeCommunity(
  raw: number,
  opts: ScoringParams['community'],
  ctx?: CommunityContext,
): number {
  if (!Number.isFinite(raw)) return 0;

  switch (opts.mode) {
    case 'native':
      return clamp(raw);

    case 'refcap': {
      const ref = Math.max(1e-9, opts.refValue);
      return clamp(100 * Math.min(1, raw / ref));
    }

    case 'minmax': {
      if (!ctx) return clamp(raw);
      const range = ctx.max - ctx.min;
      // Degenerate roster (everyone identical): rescaling carries no
      // information, so give full marks rather than inventing a spread.
      if (range <= 0) return raw > 0 ? 100 : 0;
      return clamp((100 * (raw - ctx.min)) / range);
    }
  }
}

const clamp = (x: number): number => Math.min(100, Math.max(0, x));
