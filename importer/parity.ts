/**
 * `npm run parity` — check the simulator reproduces production.
 *
 * For each published run (the latest by default, `--all` for every one), scores
 * and allocates with the run's own config two ways and compares with what
 * production published:
 *
 *   frozen   the run's frozen Dataset, exactly as production scored it
 *   history  the full-history import evaluated as of the run's as-of
 *
 * Scores, ranks, cohorts and powers must match. A score off in the last bit is
 * reported apart: glibc's `pow`, which production's Python calls, is not quite
 * correctly rounded (≤ 0.52 ulp) and the simulator's is.
 *
 * `--all` checks every run's frozen Dataset. Runs by older production code may
 * differ by design, and their full-history check drifts wherever HighSignal has
 * since revised a past score, so `--all` skips that one.
 */
import {
  fromRunExport,
  prepare,
  productionScenario,
  runScenario,
  type Dataset,
  type ProductionRun,
} from '../scoring-core/index.js';
import { dbPath, flag, main, runFlag } from './args.js';
import { baseline, openPipeline, publishedRuns, readPipeline, runExport } from './pipeline.js';

interface Diff {
  rows: number;
  score: number;
  lastBit: number;
  rank: number;
  cohort: number;
  power: number;
  missing: number;
  example: string | null;
}

function compare(dataset: Dataset, published: ProductionRun, asOf: string): Diff {
  const outcome = runScenario(prepare(dataset), productionScenario(dataset), asOf);
  if (!outcome.allocation) throw new Error(outcome.error ?? 'allocation failed');
  const ours = new Map(outcome.rows.map((r) => [r.address, r]));
  const diff: Diff = { rows: published.rows.length, score: 0, lastBit: 0, rank: 0, cohort: 0, power: 0, missing: 0, example: null };
  for (const p of published.rows) {
    const r = ours.get(p.address);
    if (!r) {
      diff.missing++;
      continue;
    }
    const cohort = outcome.allocation.members.get(p.address) ?? null;
    const power = outcome.allocation.power.get(p.address) ?? 0;
    const bad: string[] = [];
    if (r.score !== p.score) {
      if (r.score !== null && p.score !== null && nearlyEqual(r.score, p.score)) diff.lastBit++;
      else (diff.score++, bad.push(`score ${r.score} ≠ ${p.score}`));
    }
    if (r.rank !== p.rank) (diff.rank++, bad.push(`rank ${r.rank} ≠ ${p.rank}`));
    if (cohort !== p.cohort) (diff.cohort++, bad.push(`cohort ${cohort} ≠ ${p.cohort}`));
    if (power !== p.power && !nearlyEqual(power, p.power)) (diff.power++, bad.push(`power ${power} ≠ ${p.power}`));
    if (bad.length && !diff.example) diff.example = `${p.address}: ${bad.join(', ')}`;
  }
  return diff;
}

const nearlyEqual = (a: number, b: number) => Math.abs(a - b) <= 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));

const ok = (d: Diff) => d.score + d.rank + d.cohort + d.power + d.missing === 0;

function report(label: string, d: Diff): void {
  const lastBit = d.lastBit ? ` (${d.lastBit} score${d.lastBit > 1 ? 's' : ''} off in the last bit)` : '';
  console.log(
    ok(d)
      ? `  ✔ ${label}: ${d.rows} rows match${lastBit}`
      : `  ✖ ${label}: of ${d.rows} rows, ${d.score} score, ${d.rank} rank, ${d.cohort} cohort, ` +
          `${d.power} power differ, ${d.missing} missing${lastBit}\n      e.g. ${d.example ?? '—'}`,
  );
}

main(() => {
  const db = openPipeline(dbPath());
  try {
    const all = publishedRuns(db);
    const wanted = runFlag();
    const runs = flag('all') ? all : all.filter((r) => r.runId === (wanted ?? all.at(-1)?.runId));
    if (runs.length === 0) throw new Error('no matching published run');
    let failed = 0;
    for (const run of runs) {
      console.log(`run ${run.runId} (as-of ${run.asOf}, code ${run.codeVersion.slice(0, 12)})`);
      let exported: Record<string, unknown>;
      try {
        exported = runExport(db, run.runId);
      } catch (err) {
        console.log(`  – skipped: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      let frozen: Diff;
      let history: Diff | null;
      try {
        const published = baseline(db, run, exported);
        frozen = compare(fromRunExport(exported), published, run.asOf);
        history = flag('all') ? null : compare(readPipeline(db, run.runId), published, run.asOf);
      } catch (err) {
        // Runs by early production code froze an older Dataset shape.
        console.log(`  – skipped: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      report('frozen ', frozen);
      if (history) report('history', history);
      if (!ok(frozen) || (history && !ok(history))) failed++;
    }
    if (failed) {
      console.log(`${failed} of ${runs.length} runs differ`);
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
});
