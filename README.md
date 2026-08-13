# Delegate Score Simulation Engine

A standalone calibration playground for the SSV DAO's three-pillar **Delegate Score**.
It **collects** every pillar input over time, **recomputes** the score in-browser as of any
historical date, and lets you **tweak every parameter** with live sliders and charts — so the
DAO can calibrate the model empirically before ratifying it.

Implements [`.spec/simulator/SPEC.md`](.spec/simulator/SPEC.md), which is the normative algorithm
for [`.spec/proposals/delegation-score-proposal.md`](.spec/proposals/delegation-score-proposal.md).

```
DelegateScore = Σ(wᵢ · Sᵢ) / Σ(wᵢ)     for i ∈ {Community, Holdings, Votes}
```

| Pillar | Signal | Normalization | Default weight |
|---|---|---|---|
| **Community** | HighSignal overall score (Discord + Forum) | native 0–100 (or min–max / reference cap) | 3 |
| **Holdings** | SSV + cSSV, time-weighted | `100 × min(1, (TWAB/HOLD_REF)^p)`, p = 0.5 | 3 |
| **Votes** | Snapshot participation | `100 × Σ(votedₚ·dₚ)/Σdₚ`, `dₚ = 0.5^(ageₚ/H)` | 10 |

### Ratified defaults

| Parameter | Default | Meaning |
|---|---|---|
| Weights (Community / Holdings / Votes) | 3 / 3 / 10 | Relative pillar influence |
| `HOLD_REF` | 10,000 | Time-weighted holding that scores 100 |
| Concavity `p` | 0.5 | Square root — whale flattening |
| TWAB window `T` | **90 days** | How much balance history is averaged |
| Half-life `H` | 90 days | How fast a vote's weight decays |
| Proposal window `N` | **10** | How many recent closed proposals count |
| `missingPolicy` | `zero` | A delegate absent from a live pillar scores 0 |

`T` and `N` are calibrated values and **differ from the proposal text** (which says 180 and 5).
Both departures are explained in [SPEC.md §4.3–4.4](.spec/simulator/SPEC.md); everything else
matches the proposal exactly.

---

## ⚠️ Two values you must provide

Everything else is pre-configured. Copy `.env.example` to `.env` and fill in **both**:

```bash
cp .env.example .env
```

| Variable | What it is | Why it's needed |
|---|---|---|
| **`ARCHIVE_RPC_URL`** | An Ethereum **archive** node RPC endpoint | Reads `balanceOf` at historical block heights, one per day of the backfill. A normal full node **will not work** — it cannot serve historical state. |
| **`HIGHSIGNAL_API_KEY`** | HighSignal API key | Authenticates `GET https://app.highsignal.xyz/api/users` for the Community pillar. |

Secrets live in `.env` only — nothing is hardcoded, and `.env` is git-ignored.
The collector **fails fast with a named field** if either is missing.

No key handy? You can still run everything:

```bash
npm run seed:demo   # synthetic dataset → the UI runs with no credentials
```

---

## Quick start

```bash
npm install
npm test          # scoring-core — reproduces the proposal's worked example
npm run seed:demo # sample dataset (or `npm run collect` for real data)
npm run dev       # http://localhost:5173
```

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs the scoring-core + collector unit tests. |
| `npm run collect` | Backfills balances + votes + HighSignal into `data/sim.sqlite`, emits `data/dataset.json`. |
| `npm run dev` | Serves the simulator UI. |
| `npm run seed:demo` | Writes a synthetic `data/dataset.json` so the UI runs offline. |
| `npm run build` | Production build of the UI into `dist/`. |
| `npm run typecheck` | `tsc --noEmit` across all three parts. |
| `npm run doctor` | Checks whether `ARCHIVE_RPC_URL` can serve the historical state the backfill needs. Prints only the hostname, never the key. |

`collect` flags: `--days=N`, `--skip-balances`, `--skip-votes`, `--skip-highsignal`.
Re-runs are idempotent — already-collected days are skipped, so it is cheap to append new data.

---

## Sharing a dataset

Collecting needs an archive RPC and a HighSignal key; *reading* the result needs neither. So one
person collects and everyone else works from the file.

**To share:** send them your `data/dataset.json`. It is the whole input — the simulator recomputes
every score in the browser from it.

**To use one:** open the simulator and drop the file on it. A deploy with no dataset opens on an
import screen instead of failing; where a dataset is already loaded, the control in the top-right
swaps it. The file is held in IndexedDB on that device, so it survives a reload until cleared — it
is never uploaded anywhere.

Imports are validated by `parseDataset` before anything is stored, so a truncated download or the
wrong JSON file is rejected by name rather than becoming a plausible-looking leaderboard.

**Deploying:** `npm run build` bundles `data/dataset.json` into `dist/` if it exists at build time,
and succeeds without it. So `dist/` is either self-contained for peers, or a shell that asks for a
dataset — deploy it to any static host either way. Nothing else in `data/` is ever bundled;
`sim.sqlite` and the roster CSVs stay local.

---

## Architecture

```
collector (tsx) ──writes──▶ data/sim.sqlite + dataset.json ──read──▶ ui (Vite + React)
        │                                                              │
        └────────────── scoring-core (pure TS, no I/O) ────────────────┘
```

| Path | Role |
|---|---|
| `config.ts` | Derived config (addresses, endpoints) + fail-fast required-config checks. |
| `scoring-core/` | **The only place the math lives.** Pure, I/O-free, unit-tested. Imported by both sides. |
| `collector/` | `tsx` scripts: archive-RPC balances, Snapshot GraphQL votes, HighSignal provider. |
| `ui/` | Vite + React SPA. Loads `dataset.json` (bundled or imported), recomputes everything in-browser. |
| `data/` | `delegates.csv` (**input**, externally generated); `delegation-default.json` (shipped cohort defaults); `sim.sqlite`, `dataset.json` (generated). |

The UI calls `simulate()` from `scoring-core`, exactly as the tests do. That is what makes a preset
exported from the UI trustworthy as a config for the real implementation.

### Derived configuration (pre-filled)

| Key | Value |
|---|---|
| Snapshot space | `mainnet.ssvnetwork.eth` |
| Snapshot GraphQL | `https://hub.snapshot.org/graphql` |
| SSV ERC-20 | `0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54` |
| cSSV ERC-20 | `0xe018D31F120A637828F46aFD6c64EC099d960546` (1:1 with SSV) |
| Gnosis delegation API | `https://delegate-api.gnosisguild.org/api/v1` |
| Backfill length | 240 days (`BACKFILL_DAYS`) |

> **Holdings base = SSV `balanceOf` + cSSV `balanceOf`**, 1:1 — matching the proposal's
> `H(t) = balance_SSV(t) + balance_cSSV(t)`.
> If `CSSV_ADDRESS` or `ARCHIVE_RPC_URL` is missing or malformed, the collector aborts naming the
> field.

The collector backfills 240 days while the TWAB window is 90 — the extra history is what lets the
as-of scrubber recompute honest scores for earlier dates.

### Delegates who hold nothing

**Most delegates hold no SSV and no cSSV, and that is not an error.** `balanceOf` returns 0 for a
non-holder rather than reverting, so those delegates collect normally and score **0** on the
holdings pillar — correct, since they were measured and hold nothing. Their overall score still
computes from the community and votes pillars.

Four distinct cases, deliberately kept apart:

| Situation | Behaviour |
|---|---|
| Delegate holds no SSV/cSSV | Recorded as `0`. Holdings sub-score 0. **Not** an error. |
| Token had **no code** at that block (not deployed yet) | Counted as `0`, logged once per token per block. |
| Transient RPC error / rate limit | Retried with backoff, then re-checked. Not fatal. |
| Token **is** deployed but the read failed | **Aborts**, naming the token and the likely cause. |

That last split is the point: a failed read is only coerced to zero when the contract provably did
not exist yet, which makes zero the truth. Otherwise it is raised — silently dropping cSSV would
understate every holder, and roster addresses holding **cSSV only** are common enough that this is
not a hypothetical. It also means a backfill window reaching back past cSSV's deployment degrades
to "cSSV was 0 then" instead of aborting the whole run.

**cSSV was not deployed before block 24719189.** A long backfill therefore spends its earliest
days before cSSV existed, and correctly records `cssv = 0` for those dates — you will see one log
line per affected block saying so. `CSSV_DEPLOY_BLOCK` in `config.ts` exists only for that up-front
warning; the actual behaviour is driven by an on-chain `getCode` check, which stays authoritative
if the constant is ever wrong.

> **JSON-RPC batching is disabled on purpose.** A throttled provider can return a malformed,
> id-less error blob that `viem` cannot pair back to a request, so the call resolves *empty*
> instead of throwing — turning a rate limit into silently-written zero balances. Unbatched, the
> 429 surfaces as an HTTP status that the retry logic can act on. See the comment in
> `collector/rpc.ts`.

### If the collector fails mid-run

```
✖ collect failed: SSV balanceOf read failed for 0x… at block …:
  The contract function "aggregate3" returned no data ("0x").
```

On a **recent** block this is almost always a transient RPC error or rate limit, not a missing
archive — the same block usually succeeds on the next attempt. The collector retries these with
exponential backoff, and re-running is cheap in any case: already-collected days are skipped, so it
resumes where it stopped. Run `npm run doctor` to tell the two cases apart — it probes SSV and cSSV
separately at increasing depths, so a `pre-deploy` cSSV column is never mistaken for a node
limitation.

### Data model (SQLite)

```
delegates(address PK, forum_handle, discord_handle, display_name)
balances(address, date, ssv_erc20, cssv, PK(address,date))
proposals(proposal_id PK, title, end_ts)
delegate_votes(address, proposal_id, voted, PK(address,proposal_id))
highsignal_scores(address, date, score, hs_username, hs_rank, PK(address,date))
eth_communities(address PK, project, hs_username)              -- rebuilt each run
identities(delegate, address, hs_username, PK(delegate,address)) -- rebuilt each run
block_cache(date PK, block)
```

### Delegate roster — an external input

`data/delegates.csv` defines **who is scored**. It is generated **outside this pipeline** and
consumed here as a plain input — the collector reads it, validates it, and scores exactly what it
is given. Where it came from is deliberately out of scope, and roster generation is expected to
evolve independently: it is what controls how delegate accounts are discovered, identity-mapped and
included. The file checked in is a point-in-time snapshot, useful as a starting input and nothing
more.

| Column | Required | Meaning |
|---|---|---|
| `address` | yes | Ethereum address — the join key for balances, votes and community matching |
| `forumHandle` | no | Forum identity (not currently used for matching) |
| `discordUsername` | no | Discord identity (not currently used for matching) |
| `displayName` | no | Leaderboard label; falls back to `forumHandle`, then the address |

Addresses are lowercased and matched case-insensitively; duplicates collapse; a malformed address
is a hard error naming the row (a silently skipped delegate is a silently missing score). Unknown
columns are ignored, so the contract can grow without breaking existing rosters — see
[SPEC.md §3.3](.spec/simulator/SPEC.md).

### The Community pillar & HighSignal

The HTTP provider pages `…/api/users?apiKey=…&project=ssv&page=N` from `1..maxPage` and matches a
delegate to the user whose addresses contain that delegate's address.

> **Schema note.** The spec originally described an `addresses[]` field. The live API actually
> returns **`ethereumAddresses[]`** (EIP-55 checksummed). Reading the wrong field matches nobody and
> fails *silently*, so `addressesOf()` handles both spellings and is covered by tests.

> **The API key is load-bearing for matching, not just for access.** An unauthenticated request
> still returns 200 with the full user list — but **without** the addresses of users who shared them
> with the project. So a missing or wrong `HIGHSIGNAL_API_KEY` looks like "nobody matches" rather
> than an auth error. The collector warns explicitly when no user in the response exposes an
> address.

**Historical backfill.** Each record carries `historicalScores: [{day, totalScore}]` — roughly 360
daily observations on the same 0–100 scale as `score` (the newest entry equals `score`). The
collector ingests that whole series, so the community pillar has real history from the very first
run rather than only accruing forward. Today's row is written last, from the authoritative `score`
field.

**The same endpoint feeds two more things:** the extra addresses a matched user publishes (used for
identity collapse, below), and — from *other* HighSignal projects listed in
`HIGHSIGNAL_ETH_PROJECTS` — the Ethereum Communities delegation cohort. Other projects are public
and must be queried **without** the SSV key, which 401s against them.

**Coverage is limited by what users share.** Only delegates who explicitly shared an Ethereum
address with the project can be matched. On the current roster that is **5 of 486**. Under the
default `zero` policy the remaining 481 are scored 0 on community — see below.

### One person, one row

Where HighSignal reports linked addresses for a user, those addresses are treated as one identity:
the first to appear in the roster is ranked, and the rest are excluded from the leaderboard. Without
this, one person appears several times — and draws delegated voting power once per address.

This only catches links a delegate has published. Unlinked addresses are still separate rows.

### Missing data: two different cases

The proposal's graceful degradation is **pillar-level** — *"any pillar whose **data source** is not
configured is feature-flagged off and excluded from the weighted average"*. That is about the
source, not about an individual delegate, and conflating the two breaks the ranking:

| Case | Behaviour | Why |
|---|---|---|
| **No delegate** has data for a pillar (source not configured) | Excluded for everyone; score computed from the remaining pillars | The proposal's graceful degradation, verbatim |
| **One delegate** is missing from a pillar others have | `missingPolicy` — default **`zero`** | Otherwise missing data outranks a measured low score |

Excluding per-delegate is the intuitive-sounding choice and is **wrong for a leaderboard**. With
`w = {3,3,10}`, a delegate with no community profile scores `(3·50 + 10·88)/13 = 79.2`, while an
identical delegate measured at community 8 scores `(3·8 + 3·50 + 10·88)/16 = 65.9` — a 13-point
bonus for having no data.

You can watch it happen on the live roster: switching to `exclude` costs every one of the five
measured delegates rank, with the top two falling **#1 → #4** and **#2 → #6** of 486. Their own
scores did not change — 481 delegates simply stopped being penalised for having nothing to measure.

`missingPolicy: 'exclude'` remains selectable in the UI so the effect can be demonstrated, but
`zero` is the default. Imputed cells are marked `n/a` in the leaderboard rather than silently
displayed as a real 0.

> **Caveat worth weighing before ratifying weights.** Only 5 of 486 delegates currently match
> HighSignal, because so few users have shared an address. Under `zero` the other 481 are scored 0
> on community — which is right in principle (missing data must not help) but currently reflects a
> data-plumbing gap rather than actual inactivity. Fix coverage before giving this pillar real
> weight.

### Delegation impact

Separately from scoring, the simulator models how a delegatable pool is spread across five cohorts.
Each delegate draws from **at most one**:

| Cohort | Default share | Membership |
|---|---|---|
| SSV Community | 45% | Automatic — any delegate scoring above 20 |
| Verified Operators | 25% | Assigned (min 5 nominations) |
| Professional | 10% | Assigned (min 1) |
| Grant Recipients | 15% | Assigned (min 5) |
| Ethereum Communities | 5% | Automatic — high-signal contributors from other communities |

Default pool: 200,000 SSV-equivalent. A cohort's budget is split **equally** among its members, so
per-member power falls as the cohort grows — lowering the score threshold widens SSV Community and
dilutes everyone in it. The shipped defaults live in `data/delegation-default.json` and can be
exported/imported as their own preset, never mixed with a scoring preset.

**Program cap.** The pool is whatever token holders auto-delegate, and it only grows, so the program
carries a ceiling: `effective = min(pool, CAP)`, and `max(0, pool − CAP)` is **voided** — never
assigned to a cohort, never voted, and distinct from the unallocated reserve, which stays inside the
cap. The cap is applied *before* the split, so a binding cap scales every member's power down
together without changing the cohort balance or membership, and always raises a warning.
---

## Using the simulator

- **Parameter panel** — weights, `HOLD_REF`, concavity `p` (0.3–1.0, + log-mode toggle), TWAB
  window `T`, half-life `H`, proposal window `N`, community normalization, missing-data policy.
  Everything recomputes instantly, in-browser.
- **Delegation panel** — pool size, program cap (toggleable), cohort shares, score threshold and
  minimum nominations, with live member counts, voided-power readout and under-nomination warnings.
- **As-of scrubber** — pick any date in the collected range. Scores use **only** data up to that
  date: later balances, votes and HighSignal observations are ignored.
- **Leaderboard** — sortable by score, any pillar, TWAB or allocated power; searchable by name,
  handle or address; filterable by cohort and minimum power; paginated. Click a row to inspect it,
  or pin it to a cohort.
- **Charts** — DelegateScore over time per delegate; pillar breakdown for the selected delegate as
  stacked *weighted contributions* (`wᵢ·Sᵢ/Σw`), so the stack height **is** the DelegateScore.
- **Presets** — Export/Import/Copy JSON, plus a one-click reset to the ratified defaults.

### Things worth trying

Figures below are from the current roster (486 delegates, 125 proposals) at the default parameters.

| Lever | What you should see |
|---|---|
| Concavity `p` → 1.0 | Holdings goes linear; small holders collapse (a 150-token holder drops 12.2 → 1.5). |
| Half-life `H` → 720d | Recency flattens toward plain vote counting (an 8-of-10 voter who missed recent proposals moves 74.6 → 79.5). |
| Half-life `H` → 14d | Missing the *newest* proposals becomes brutal (74.6 → 36.3) — while an 8-of-10 voter who only missed old ones climbs to 99.2. |
| `missingPolicy` → exclude | The five measured delegates all lose rank; the top one falls #1 → #4. |
| SSV Community threshold ↓ | The cohort widens and per-member power falls — the dilution trade-off, live. |
| Pool → 1,000,000 at the default cap | 250,000 is voided; every cohort budget stays put, because the split is taken from the cap, not the pool. |
| Scrub back 6 months | A delegate who has since gone quiet ranks near the top again. |

---

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | `npm test` reproduces the worked example (community 82, TWAB 2500 → 50, 4-of-5 → 88.05, **DelegateScore 79.78 → displays 80**) and the whale case (TWAB 1M → 100) | ✅ 147 tests |
| 2 | `npm run collect` writes `dataset.json` with balances + votes + HighSignal per delegate | ✅ |
| 3 | `npm run dev` — any slider updates leaderboard + charts with no reload; the scrubber recomputes using only data up to that date | ✅ |
| 4 | Parameter presets export/import as JSON and round-trip to identical scores | ✅ |
| 5 | `p = 1.0` makes holdings linear; raising `H` flattens recency — both visibly | ✅ |
| 6 | Missing data never improves a rank; a pillar with no data at all is excluded for everyone | ✅ |
| 7 | A backfill shorter than `T` does not distort TWAB, and the shortfall is surfaced | ✅ |
| 8 | Each delegate draws power from at most one cohort; a linked identity appears once | ✅ |

### On the worked example's vote figure

The proposal states 4-of-5 (oldest missed, `H=90`) → **88**, and cross-checks that missing the
*most recent* instead gives **~70**. It never states the proposal spacing, which the formula needs.
30-day spacing is the value that satisfies both constraints simultaneously — `88.05` and `69.88` —
so that is what the fixtures use. The absolute anchor date is irrelevant: shifting every proposal
by the same amount scales numerator and denominator alike and leaves the ratio unchanged.

The example has five closed proposals, so it reads identically at `N = 10` and `N = 5`: the window
takes every proposal available. Sub-scores enter the composite **unrounded** — `88.05`, not `88`,
which is why the result is `79.78` and not `79.75`.

---

## Notes

- `data/dataset.json`, `data/sim.sqlite` and `.env` are git-ignored; `delegates.csv` is
  committed as a sample. A dataset is shared as a file rather than committed —
  see [Sharing a dataset](#sharing-a-dataset).
- External calls retry with exponential backoff; block-number-per-date is cached in SQLite, so a
  re-run does not re-resolve blocks.
- Out of scope, per the spec: writing scores on-chain, auth, multi-user state.
