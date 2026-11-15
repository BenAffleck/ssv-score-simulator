# Delegate Score Simulator

Re-runs the production Delegate Score pipeline ([`ssv-scoring`](../ssv-scoring)) on production's
own data, in the browser, with any lever changed — so the DAO can see what a proposed change does
to every delegate's rank, seat and voting power before voting on it.

The scoring core is a line-for-line TypeScript port of production's `ssv_score.scoring`. At
production's settings it reproduces the published leaderboard and allocation exactly; every
number in a scenario is shown next to production's (Δ).

Spec: [`.spec/simulator/SPEC.md`](.spec/simulator/SPEC.md). Normative algorithm: production.

## Quick start

```bash
npm install
npm run import    # reads ../ssv-scoring/data/pipeline.sqlite (read-only) → data/dataset.json
npm run parity    # checks the simulator reproduces production's latest run
npm run dev       # http://localhost:5173
```

No production database? `npm run seed:demo` writes a synthetic `data/demo-dataset.json` to drop on
the simulator, or drop a single run's `ssv-score export-dataset` file (scores that one as-of).

## Commands

| Command | What it does |
|---|---|
| `npm run import` | Writes `data/dataset.json` from production. `--db=<path>` (or `$PIPELINE_DB`), `--run=<id>` (default latest published), `--export=<file>` to convert a run export, `--out=<file>`. |
| `npm run parity` | Scores the latest run from its frozen Dataset and from the full-history import, and compares every score, rank, cohort and power with what production published. `--run=<id>`, `--all`. |
| `npm test` | Ported production tests for the pure stages, plus scenario and numerics tests. |
| `npm run dev` / `build` | UI. `build` bundles `data/dataset.json` into `dist/` if present. |
| `npm run typecheck` | `tsc --noEmit`. |

## What it models

The Delegate Score is production's: `Σ wᵢSᵢ / Σ wᵢ` over live pillars, every roster address
scored and ranked on its own. Allocation is production's: the pool (the auto-delegation Safe's
power) capped, split 45/25/10/15/5, one seat per identity, nominations first, then SSV Community
(score > threshold), then Ethereum Communities. Opted-out addresses and auto-delegators stay
ranked but draw no seat.

### Levers

| Lever | In production |
|---|---|
| Weights, community ref, HOLD_REF, concavity, TWAB window, half-life, proposal window | `config/params.json` |
| Cap, SSV Community threshold, cohort shares and minimums | `config/delegation.json` |
| Nominations (leaderboard cohort column) | `config/nominations.csv` |
| Pool override | Read from the Safe each run; override to model the pool growing or shrinking |
| Roster sources | Production scores every discovered candidate; narrowing models an eligibility change |

Each config panel exports the exact production file, so a ratified scenario is deployed by
committing it to `ssv-scoring/config/`.

### As-of scrubber

The dataset holds production's full history, and every as-of is scored with production's freeze
cutoffs: only balances, votes (cast before the day ended) and HighSignal observations up to the
end of that day. Opt-outs, auto-delegators, ETH-community members and nominations are those of the
imported run; the pool is production's for that day where a run exists.

## Parity with production

`npm run parity` against the current database:

- The latest run (#29, 2026-11-02) reproduces bit-for-bit — all 909 rows — both from its frozen
  Dataset and from the full-history import.
- Every run by current production code (#12 onwards) reproduces from its frozen Dataset. Runs
  #26–28 each have one score off in the last bit: glibc's `pow`, which production's Python calls,
  is ≤ 0.52 ulp, and the simulator's is correctly rounded. Runs #9–10 predate production's current
  seat rule.
- Rescoring an old run from today's full history drifts where HighSignal has since revised a
  past score; production stores the latest value per day.

Getting there required matching Python's arithmetic, not just its formulas: CPython 3.12's
compensated `sum()`, a correctly rounded `pow`, and exact decimal SSV + cSSV sums.

## Changes from v1

v1 collected its own data and was the calibration tool for the proposal. Production now owns
collection, so v1's collector, its `delegates.csv` roster, `.env` secrets and SQLite cache are gone;
the old `data/sim.sqlite` and `.env` can be deleted locally. Behaviour now follows production:

| v1 | Now (production) |
|---|---|
| Fixed 486-address `delegates.csv` roster | Production's discovered roster (grandfathered, Snapshot voters/followers, HighSignal, nominations) |
| Linked addresses collapsed to one row | Every address ranked; one **seat** per identity |
| Community modes native / min–max / refcap | One formula: `100·clamp(hs/ref, 0, 1)` |
| Holdings log mode | Power only |
| `missingPolicy` zero / exclude | Zero, hardwired |
| Votes: any vote, age from 23:59:59, flagged proposals counted | Votes cast before the as-of ended, age from its close, flagged proposals excluded |
| Pin to any cohort | Nominations to the three nominated cohorts; conflicts are errors |
| Fixed 200,000 pool, cap 750,000 | Pool read from the Safe (≈299k on 2026-11-02), cap 500,000 |
| — | Opt-outs and auto-delegators draw no seat |
