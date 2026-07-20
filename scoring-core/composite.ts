/**
 * Composite — DelegateScore = Σ(wᵢ·Sᵢ) / Σ(wᵢ), i ∈ {community, holdings, votes}.
 *
 * Every Sᵢ is already 0–100, so the result is automatically 0–100.
 */
import type { PillarScores, ScoringParams } from './types.js';

/**
 * Pillars with no data (null) are excluded from both sides of the average —
 * the proposal's "graceful degradation": a pillar whose source is not
 * configured is treated as weight 0 rather than as a zero score, which would
 * silently punish the delegate.
 *
 * Returns null when no pillar has data (or all weights are 0).
 */
export function delegateScore(pillars: PillarScores, weights: ScoringParams['weights']): number | null {
  let num = 0;
  let den = 0;

  for (const key of ['community', 'holdings', 'votes'] as const) {
    const s = pillars[key];
    const w = weights[key];
    if (s === null || !Number.isFinite(s) || !Number.isFinite(w) || w <= 0) continue;
    num += w * s;
    den += w;
  }

  return den > 0 ? num / den : null;
}
