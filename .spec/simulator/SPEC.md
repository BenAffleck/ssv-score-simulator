# Spec: Delegate Score Simulator

> **Status:** v2 — migrated onto the production pipeline.
> **Normative algorithm:** the production pipeline, `ssv-scoring` (`src/ssv_score/scoring/`,
> `docs/scoring/SCORING.md`, `docs/pipeline/SPEC.md`). Where this document and production
> disagree, production wins and this simulator is wrong.

## 1. Goal

v1 of this simulator collected its own data and let the DAO calibrate the Delegate Score before
ratifying it. The DAO did, and the production pipeline (`ssv-scoring`) and the Delegation Portal
(`ssv-daox`) now operate it. v2 exists to answer **"what would production do if we changed X?"**:

1. Re-run production's scoring and allocation **exactly**, on production's own data.
2. Change any lever production fixes — scoring params, delegation config, nominations, the pool,
   which roster sources count — and see every row's rank, seat and power against production's.
3. Export a ratified scenario as the production config files that implement it.

Out of scope: collecting data (production does), writing anything to production.

## 2. Architecture

```
ssv-scoring pipeline.sqlite ──npm run import──▶ data/dataset.json ──▶ ui (Vite + React)
ssv-score export-dataset file ─────────────────▶ (same, one as-of)          │
                                                                            │
             scoring-core (pure TS port of ssv_score.scoring) ◀─────────────┘
```

| Path | Role |
|---|---|
| `scoring-core/` | Pure, I/O-free port of production's `scoring/` package, plus scenario levers. |
| `importer/` | Reads production's SQLite **read-only** into a dataset; parity checker; demo seed. |
| `ui/` | Recomputes everything in-browser from the dataset. |

## 3. Port of production — normative mapping

| Production (`ssv_score/scoring/`) | Simulator (`scoring-core/`) |
|---|---|
| `community.py` `community_pillar` | `pillars.ts` `communityPillar` |
| `holdings.py` `holdings_pillar` | `pillars.ts` `holdingsPillar` |
| `votes.py` `votes_pillar` | `pillars.ts` `votesPillar` |
| `composite.py` `combine`, `rank` | `score.ts` `combine`, `rank` |
| `score.py` `evaluate` | `score.ts` `evaluate` |
| `identity.py` `group` | `identity.ts` `group` |
| `allocation.py` `allocate` | `allocation.ts` `allocate` |
| `run.py` `derive` | `simulate.ts` `runScenario` |
| `run.py` `freeze` cutoffs | applied at scoring time (§4) |
| `config/params.json`, `delegation.json`, `nominations.csv` | `Params`, `Delegation`, `Nomination` — same shapes |

Rules carried over verbatim, among others: community `100·clamp(hs/ref,0,1)` over the latest
observation on or before the as-of; holdings window ending at the last collected day ≤ as-of,
intersected with dataset-wide coverage, carry-forward, `100·min(1,(TWAB/ref)^p)`; the N latest
proposals with `end < endOfDay(asOf)`, flagged proposals excluded, age measured from the end of the
as-of, only votes cast before it; missing data in a live pillar is 0 and flagged (no
`missingPolicy`); every roster address scored and ranked on its own (no identity collapse); one
seat per identity held by its highest-scoring qualifying address; nominations restricted to
nominated cohorts, a conflicting identity is an error; opted-out addresses and auto-delegators draw
no seat; the cap applies to the pool before the split.

**Numerics.** Scores are ranked unrounded with ties broken by address, so the port reproduces
Python's arithmetic: `pysum.ts` is CPython 3.12's compensated `sum()`, `pow.ts` a correctly
rounded `pow` (V8's `**` is not), `decimal.ts` sums SSV + cSSV exactly before one rounding, as
`float(Decimal + Decimal)` does. glibc's `pow` (≤ 0.52 ulp) occasionally misrounds where the
simulator's does not; that is the only known source of difference, and it is last-bit only.

## 4. Dataset (version 3)

`types.ts` `Dataset`. Built by `npm run import` from production's store, so it holds **full
history**, not one frozen run. Scoring an as-of applies production's freeze cutoffs: nothing dated
after the end of the as-of is read.

Allocation inputs production records only per run — nominations, ETH-community members, opt-outs,
auto-delegators — come from the imported run (default: latest published) and apply to every
as-of. The pool is per as-of: the newest published run's pool for that day, else the latest
earlier one. `production` holds the run's config and published rows, the baseline for parity and
for every Δ in the UI.

A production run export (`ssv-score export-dataset`) is accepted too and scores only its as-of.

## 5. Scenario levers

`simulate.ts` `Scenario`:

| Lever | Production equivalent |
|---|---|
| `params` | `config/params.json` (DAO vote) |
| `delegation` | `config/delegation.json` (DAO vote) |
| `nominations` | `config/nominations.csv` (committees) |
| `pool` | none — production reads the Safe's power; override to model growth |
| `sources` | none — production scores every discovered candidate; filtering models an eligibility change |

## 6. Acceptance

| # | Criterion | Check |
|---|---|---|
| 1 | The ported tests of production's pure stages pass | `npm test` |
| 2 | The latest production run reproduces: every score, rank, cohort and power, from the frozen run and from the full-history import | `npm run parity` |
| 3 | Every published run by current production code reproduces from its frozen Dataset | `npm run parity -- --all` |
| 4 | A scenario at production's levers shows no Δ and states that it reproduces the run | UI |
| 5 | Exported config files are accepted by production's validators unchanged | shapes in `params.ts` |
