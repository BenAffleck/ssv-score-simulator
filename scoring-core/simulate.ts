/**
 * A scenario — production's run with any lever changed — evaluated as of a day.
 *
 * `runScenario` is production's `run.derive` (score, group identities,
 * allocate) over the simulator's dataset, plus the levers production fixes:
 * the pool, the nominations and which roster sources count.
 */
import { allocate, NominationConflictError, type Allocation } from './allocation.js';
import { group, type Identity } from './identity.js';
import { cloneDelegation, cloneParams, DEFAULT_DELEGATION, DEFAULT_PARAMS } from './params.js';
import type { Prepared } from './prepared.js';
import { evaluate } from './score.js';
import type { Dataset, Delegation, Nomination, Params, Row } from './types.js';

export interface Scenario {
  params: Params;
  delegation: Delegation;
  /** Pool override; `null` uses the Safe's power production read for the as-of. */
  pool: number | null;
  nominations: Nomination[];
  /** Roster sources that count; `null` counts every candidate, as production does. */
  sources: string[] | null;
}

/** What production runs: its latest run's config and nominations, or the ratified defaults. */
export function productionScenario(dataset: Dataset): Scenario {
  return {
    params: cloneParams(dataset.production?.params ?? DEFAULT_PARAMS),
    delegation: cloneDelegation(dataset.production?.delegation ?? DEFAULT_DELEGATION),
    pool: null,
    nominations: dataset.nominations.map((n) => ({ ...n })),
    sources: null,
  };
}

/** The pool production read on the latest run on or before `asOf`, else its earliest. */
export function poolAt(dataset: Dataset, asOf: string): number {
  let pool = dataset.pools[0]?.pool ?? 0;
  for (const p of dataset.pools) if (p.asOf <= asOf) pool = p.pool;
  return pool;
}

export interface Outcome {
  rows: Row[];
  identities: Map<string, Identity>;
  /** Null when allocation failed, e.g. on a nomination conflict; see `error`. */
  allocation: Allocation | null;
  error: string | null;
  pool: number;
}

export function runScenario(p: Prepared, scenario: Scenario, asOf: string): Outcome {
  const rows = evaluate(p, scenario.params, asOf, rosterFilter(p, scenario.sources));
  const identities = group(
    rows.map((r) => r.address),
    p.dataset.identities,
  );
  const pool = scenario.pool ?? poolAt(p.dataset, asOf);
  try {
    const allocation = allocate({
      scores: new Map(rows.map((r) => [r.address, r.score])),
      pool,
      delegation: scenario.delegation,
      nominations: scenario.nominations,
      identities: new Map([...identities].map(([address, identity]) => [address, identity.id])),
      ethCommunity: new Set(p.dataset.ethCommunity),
      optedOut: new Set(p.dataset.optedOut),
      safeDelegators: new Set(p.dataset.safeDelegators),
    });
    return { rows, identities, allocation, error: null, pool };
  } catch (err) {
    if (!(err instanceof NominationConflictError)) throw err;
    return { rows, identities, allocation: null, error: err.message, pool };
  }
}

/**
 * Which roster addresses count when only `sources` do; undefined counts all.
 * An address the dataset gives no source for always counts.
 */
export function rosterFilter(p: Prepared, sources: string[] | null): ((address: string) => boolean) | undefined {
  if (!sources) return undefined;
  const kinds = new Set(sources);
  const included = new Set(
    p.roster
      .filter((c) => c.sources.length === 0 || c.sources.some((s) => kinds.has(sourceKind(s))))
      .map((c) => c.address),
  );
  return (address) => included.has(address);
}

/** `highsignal_eth:lido` → `highsignal_eth`: the source kinds the roster filter offers. */
export function sourceKind(source: string): string {
  return source.split(':')[0]!;
}

export const round2 = (x: number): number => Math.round(x * 100) / 100;
