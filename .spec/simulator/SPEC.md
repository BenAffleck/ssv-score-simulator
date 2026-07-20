# Spec: Delegate Score Simulation Engine

A standalone tool to **collect all Delegate Score inputs over time**, **recompute the score
in-browser in real time**, and **tweak every parameter empirically** with live sliders and
charts — so the DAO can calibrate the scoring model before ratifying it.

It implements the three-pillar **Delegate Score** defined in
`.spec/proposals/delegation-score-proposal.md`. Read that proposal first; this spec assumes its
formulas and pins down every detail the proposal deliberately left open.

> **Status:** implemented and verified against live data sources.
> §4 is **normative** — it is the algorithm a production implementation must reproduce.

---

## 1. Goal & scope

- **Collect** a time series of every pillar input, for the delegates named in an externally
  supplied roster (§3.3): token balances, Snapshot vote history, and HighSignal community scores.
- **Simulate** the overall score, and each pillar sub-score, **as of any historical date** (a
  time scrubber), using only data available up to that date.
- **Tweak** every parameter (weights, reference caps, concavity, windows, half-life,
  normalization, missing-data policy) via a simple UI and see the leaderboard + charts update
  instantly.
- **Export/import** parameter presets as JSON so a chosen configuration can feed the real
  implementation.

Out of scope: writing scores back on-chain, auth, multi-user state. This is a local calibration
playground.

---

## 2. Architecture

```
collector (Node/tsx)  ──writes──▶  local dataset (SQLite + JSON)  ──read──▶  simulator UI (Vite+React)
        │                                                                        │
        └── scoring-core (pure TS, no I/O) ◀───────────────shared──────────────┘
```

- **`scoring-core/`** — pure functions implementing the pillar formulas. No I/O, fully unit
  tested. Imported by both the collector and the UI so the math is defined exactly once.
- **`collector/`** — `tsx` scripts that fetch/backfill time-series data into `data/sim.sqlite`.
- **`ui/`** — a Vite + React single-page app that loads `data/dataset.json` and recomputes
  scores in-browser on every parameter change.

**Stack:** TypeScript throughout. UI: Vite + React + Recharts. Storage: SQLite via
`better-sqlite3`; the collector emits `data/dataset.json` for the UI.

---

## 3. Configuration

### 3.1 Derived (defaults in `config.ts`)

| Key | Value |
|---|---|
| Primary Snapshot space | `mainnet.ssvnetwork.eth` |
| Snapshot GraphQL API | `https://hub.snapshot.org/graphql` |
| SSV ERC-20 (chain 1, 18 dec) | `0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54` |
| cSSV ERC-20 (chain 1, 18 dec) | `0xe018D31F120A637828F46aFD6c64EC099d960546` |
| cSSV deployment block | `24719189` — earlier dates legitimately have cSSV = 0 |
| Gnosis delegation API | `https://delegate-api.gnosisguild.org/api/v1` |
| HighSignal API | `https://app.highsignal.xyz/api/users` — params `apiKey`, `project=ssv`, `page` |

> **Holdings base = SSV `balanceOf` + cSSV `balanceOf`, 1:1.** This matches the proposal's
> `H(t) = balance_SSV(t) + balance_cSSV(t)`. An earlier revision of this spec also summed an SSV
> vesting contract (`0xB847…59Bf`, `totalVestingBalanceOf`); that component has been **removed**.

### 3.2 Required (env, never hardcoded)

| Key | Notes |
|---|---|
| `ARCHIVE_RPC_URL` | Ethereum **archive** node. Needed to read `balanceOf` at historical blocks. |
| `HIGHSIGNAL_API_KEY` | Auth for HighSignal. **Also gates address visibility** — see §5.3. |

The collector fails fast, naming the field, if either is missing or malformed. `npm run doctor`
verifies the RPC can actually serve the required history before a long backfill.

### 3.3 Delegate roster — an external input

`data/delegates.csv` defines **who is scored**. It is produced **outside this pipeline** by a
separate roster-generation step and consumed here as a plain input. Its provenance is explicitly
out of scope: the collector reads it, validates it, and scores exactly what it is given.

This boundary is deliberate. Roster generation is what controls how delegate accounts are
**discovered, identity-mapped and included** — and it is expected to change independently of the
scoring model. Nothing downstream may assume where the file came from, that it is complete, or
that it is stable between runs. The file currently checked in is a point-in-time snapshot of the
delegate set in the existing system, useful as a starting input and nothing more.

**Input contract (v1):**

| Column | Required | Meaning |
|---|---|---|
| `address` | yes | Ethereum address. The join key for balances, votes and community matching. |
| `forumHandle` | no | Governance-forum identity. Not currently used for matching. |
| `discordUsername` | no | Discord identity. Not currently used for matching. |
| `displayName` | no | Label for the leaderboard; falls back to `forumHandle`, then the address. |

Validation on load, all normative:

- `address` is lowercased; matching everywhere is case-insensitive.
- A malformed `address` is a **hard error** naming the row — a silently skipped delegate is a
  silently missing score.
- Duplicate addresses collapse to the first occurrence.
- Empty optional fields are permitted and common; they must not cause a row to be dropped.
- An empty roster is a hard error.

**Expected evolution.** The contract is versioned because it will grow. The most likely addition is
an explicit community identity (e.g. a HighSignal username) so the Community pillar can be matched
by declared mapping rather than by address discovery — today's binding coverage constraint (§8).
Adding optional columns is backward-compatible; consumers must ignore unknown columns rather than
fail on them.

---

## 4. Scoring core — normative algorithm

All functions pure. All dates are UTC `YYYY-MM-DD`. Balances and scores are the values *as of the
simulated date*; nothing after `asOf` may influence a result.

### 4.1 Parameters

```ts
weights        = { community, holdings, votes }     // default 3 / 3 / 10
holdings       = { ref, concavity p, mode, windowDays T }  // 10000 / 0.5 / 'power' / 180
votes          = { halfLifeDays H, windowN N }      // 90 / 5
community      = { mode, refValue }                 // 'native' / 100
missingPolicy  = 'zero' | 'exclude'                 // default 'zero'
```

### 4.2 Pillar 1 — Community Contribution

```
S_community = normalizeCommunity(hs, { mode, refValue })
  'native' : clamp(hs, 0, 100)                       // HighSignal is already 0–100
  'refcap' : 100 · min(1, hs / refValue)
  'minmax' : 100 · (hs − min) / (max − min)          // min/max over delegates WITH data
             → 100 if max = min and hs > 0, else 0
```

`hs` is the **most recent HighSignal observation dated ≤ asOf**. Never interpolated, never
forward-filled from the future. `null` if the delegate has no observation at or before `asOf`.

### 4.3 Pillar 2 — Token Holdings

```
COVERAGE      = [min, max] over all collected balance dates, dataset-wide
daily(d, day) = ssvErc20 + cssv, carried forward from the last sample ≤ day, else 0
window        = [asOf − T + 1, asOf] ∩ COVERAGE     // exactly T days when history allows
TWAB          = mean(daily(d, day) for day in window)
S_holdings    = 100 · min(1, (TWAB / HOLD_REF) ^ p)             // 'power'
              = 100 · min(1, ln(1+TWAB) / ln(1+HOLD_REF))       // 'log'
```

Three rules that are easy to get wrong and are **normative**:

1. **The window is intersected with collected coverage.** Averaging over uncollected days divides
   by a period that was never measured. With a 5-day backfill and `T = 180`, a steady 12,000-token
   holder would otherwise read as TWAB 333 and score 18 instead of 100.
2. **Coverage is dataset-level, not per-delegate.** Every delegate is averaged over the same days,
   so a delegate with a shorter history gains no advantage.
3. **Zeros must be recorded, not assumed.** The collector writes a row for every delegate on every
   collected day, so "held nothing then" is a stored fact. This is what preserves the anti-flash-loan
   property: recorded zeros still dilute a late purchase.

`TWAB = null` when `asOf` precedes all collected data, or the delegate has no balance rows —
*unmeasured*, which is distinct from a measured zero. Beyond the last collected day, TWAB is
evaluated at that day rather than extrapolating.

The window is **exactly `T` days**, inclusive of `asOf` (`[asOf − T + 1, asOf]`). The proposal's
`[asOf − T, asOf]` would be `T + 1`; `T` is used.

### 4.4 Pillar 3 — Snapshot Participation

```
asOfTs   = end of the asOf day (23:59:59 UTC)
window   = the N proposals with the largest endTs ≤ asOfTs
age_p    = (asOfTs − endTs_p) / 86400
d_p      = 0.5 ^ (age_p / H)
S_votes  = 100 · Σ(voted_p · d_p) / Σ(d_p)
```

`null` when no proposal has closed at or before `asOf`. Proposals that closed *after* `asOf` are
never counted — a delegate is not penalised for a vote that had not yet been possible.

The choice of anchor (end of day vs midnight) does not affect the result: shifting every proposal
by the same amount scales numerator and denominator alike.

### 4.5 Missing data — pillar-level vs delegate-level

This is the part the proposal's "graceful degradation" clause does **not** settle, and getting it
wrong inverts the leaderboard.

```
live(i) = ∃ delegate : S_i(delegate) ≠ null          // is the source configured at all?

if S_i(d) = null:
    ¬live(i)                    → S_i(d) := null     // pillar off for EVERYONE
    live(i) ∧ policy = 'zero'   → S_i(d) := 0        // default
    live(i) ∧ policy = 'exclude'→ S_i(d) := null
```

- **Pillar-level absence** (no delegate has data) is the proposal's graceful degradation: the
  source is not configured, so the pillar is excluded for everyone and the score is computed from
  the rest. Nobody is penalised.
- **Delegate-level absence** (the pillar is live, this delegate is missing from it) must **not**
  be excluded. Excluding it makes "no data" strictly better than "measured but low": with
  `w = {3,3,10}`, a delegate with no community profile scores `(3·50 + 10·88)/13 = 79.2` while an
  identical delegate measured at 8 scores `(3·8 + 3·50 + 10·88)/16 = 65.9`.

`'exclude'` remains selectable **in the simulator only**, so the failure mode can be demonstrated.
Production should use `'zero'`. Imputed values are flagged (`missing.<pillar> = true`) and must be
displayed as imputed, never as a measurement.

### 4.6 Composite & ranking

```
DelegateScore = Σ(w_i · S_i) / Σ(w_i)   over i where S_i ≠ null and w_i > 0
              = null                     if that denominator is 0
```

Every `S_i ∈ [0,100]`, so the result is automatically 0–100.

- A weight of 0 flags a pillar off for everyone.
- Scores are stored and ranked **unrounded**; rounding is a display concern only.
- Ranking is by score descending, **ties broken by address ascending**, so the order is
  deterministic across runs and parameter changes.

---

## 5. Data collection

The collector backfills history and can be re-run to append new days (idempotent upserts).

### 5.1 Balances — archive RPC

For each delegate, for each day in the backfill range, read at the block nearest that day's UTC
midnight: `SSV.balanceOf` and `cSSV.balanceOf`, batched via Multicall3. Store as decimal (18 dec).

Block-per-date is resolved by bracketing outward from the previous day's block (not a full-chain
binary search) and cached in `block_cache`.

Failure handling is **three-way** and normative:

| Situation | Behaviour |
|---|---|
| Delegate holds nothing | `balanceOf` returns 0. Recorded as 0. Not an error. |
| Token has **no code** at that block (not yet deployed) | Recorded as 0, logged once per token per block. |
| Token **is** deployed but the read failed | Abort, naming the token and likely cause. |

A failed read is only coerced to 0 when the contract provably had no code at that block, which
makes 0 the truth. Everything else is surfaced — silently dropping cSSV would understate every
holder.

**Transient failures must be retried.** With `allowFailure: true`, a transport-level error does not
throw: the client reports every sub-call as failed. Treat an all-failed batch whose contracts *do*
have code as transient and retry with backoff. Without this, one blip aborts an entire backfill.

### 5.2 Votes — Snapshot GraphQL

Fetch all closed proposals of the space (`id, title, end`), then all votes by roster addresses via
`votes(where: { space, voter_in: [...] })`, paginated. Store proposals and
`(address, proposal_id, voted)`. No API key required.

### 5.3 Community — HighSignal

`GET https://app.highsignal.xyz/api/users?apiKey=<KEY>&project=ssv&page=N`, looping `page` from 1
to `maxPage`. Response: `{ data[], maxPage, totalResults, currentPage, resultsPerPage }`.

**Verified record schema** (differs from earlier drafts of this spec):

```jsonc
{
  "username": "…", "displayName": "…", "rank": 56, "score": 8,
  "signal": "high",
  "ethereumAddresses": ["0x2de6…"],          // NOT "addresses"
  "historicalScores": [{ "day": "2026-07-19", "totalScore": 7 }, …],  // ~360 days, newest first
  "signalStrengths": [{ "signalStrengthName": "discord", "data": [ … ] }]
}
```

Three findings that must carry into production:

1. **The field is `ethereumAddresses`, not `addresses`.** Reading the wrong key matches nobody and
   fails *silently*. Accept both spellings defensively.
2. **The API key gates address visibility, not just access.** An unauthenticated request still
   returns HTTP 200 with the full user list — but omits the addresses of users who shared them with
   the project. Measured: with key, 2 of 191 users expose an address; without, 1. A missing key
   therefore looks like "nobody matches", never like an auth error. Warn explicitly when no user in
   the response exposes an address.
3. **`historicalScores` is a real backfill source.** ~360 daily observations on the same 0–100
   scale as `score` (the newest entry equals `score`). Ingest the whole series; the community pillar
   then has history from the first run rather than only accruing forward. Write today's row last,
   from the authoritative `score` field.

Addresses are returned EIP-55 checksummed; the roster is lowercase. Normalise both sides.

Matching is **by address membership** (`delegate.address ∈ user.ethereumAddresses`). A delegate
with no match gets a `null` community pillar, resolved by §4.5.

> **Coverage is the binding constraint.** Only delegates who explicitly shared an address can be
> matched — currently 1 of 50 on the live roster. See §8.

Behind a `HighSignalProvider` interface: `HttpHighSignalProvider` (default) and
`CsvHighSignalProvider` reading `data/highsignal.csv` (`address,date,score[,username,rank]`) for
offline runs and manual backfill.

### 5.4 Data model (SQLite)

```
delegates(address PK, forum_handle, discord_handle, display_name)
balances(address, date, ssv_erc20, cssv, PRIMARY KEY(address,date))
proposals(proposal_id PK, title, end_ts)
delegate_votes(address, proposal_id, voted INT, PRIMARY KEY(address,proposal_id))
highsignal_scores(address, date, score, hs_username, hs_rank, PRIMARY KEY(address,date))
block_cache(date PK, block)
```

The collector emits `data/dataset.json` (delegates + the above series) for the UI.

---

## 6. Simulator UI

A single page:

- **Parameter panel** (all live, recompute on change): pillar weights; `HOLD_REF`, concavity `p`
  (0.3–1.0, sqrt at 0.5, linear at 1.0), log-mode toggle, TWAB window `T`; half-life `H`, proposal
  window `N`; community normalization mode + reference value; **missing-data policy**.
- **As-of date scrubber** — every score computed using only data up to that date.
- **Leaderboard** — ranked by DelegateScore, per-pillar sub-scores, sortable. Imputed pillars are
  marked `n/a`; weight-0 pillars are dimmed.
- **Charts** — DelegateScore over time per delegate; pillar breakdown for the selected delegate as
  stacked **weighted contributions** (`w_i·S_i/Σw`), so stack height equals the DelegateScore.
- **Presets** — export/import/copy JSON; reset to proposal defaults.
- **Warnings** — when the TWAB window exceeds collected history, say so; that shortfall is
  otherwise invisible and silently understates holdings.

Everything recomputes in-browser via `scoring-core`; no server round-trips while tweaking.

**Performance.** TWAB is served from per-delegate prefix sums built once at index time, community
lookup and proposal-window selection are binary searches. At 480 delegates × 240 days a full
recompute (leaderboard + two 90-point charts) is ~220 ms; a naive per-day walk was ~100× slower and
made the tool unusable at roster scale.

---

## 7. Repo layout & commands

```
delegate-score-sim/
  config.ts                 # derived + required config, fail-fast validation
  scoring-core/             # pure formulas + unit tests (§4)
    community.ts holdings.ts votes.ts composite.ts simulate.ts params.ts dates.ts types.ts
  collector/
    collect-balances.ts     # archive-RPC historical balances
    collect-votes.ts        # Snapshot GraphQL vote history
    highsignal/             # HighSignalProvider + HTTP + CSV adapters
    build-dataset.ts        # writes data/sim.sqlite + data/dataset.json
    doctor.ts               # archive-RPC / coverage diagnostics
    seed-demo.ts            # synthetic dataset for offline UI runs
  ui/                       # Vite + React app (§6)
  data/                     # delegates.csv (INPUT, externally generated)
                            # sim.sqlite, dataset.json, highsignal.csv (generated)
  README.md
```

| Command | Purpose |
|---|---|
| `npm run collect` | Backfill/refresh dataset. Flags: `--days=N`, `--skip-balances`, `--skip-votes`, `--skip-highsignal` |
| `npm test` | scoring-core + collector unit tests |
| `npm run dev` | Launch simulator UI |
| `npm run doctor` | Verify the archive RPC serves the needed history |
| `npm run seed:demo` | Synthetic dataset, no credentials required |

---

## 8. Acceptance criteria

1. `npm run test` passes, reproducing the proposal's worked example (Alice → **80**) and the whale
   case (TWAB 1M → holdings 100). ✅ 98 tests
2. `npm run collect` produces `data/dataset.json` with balances, votes and HighSignal series for
   every delegate in `delegates.csv` (HighSignal via the paginated `/api/users` endpoint, matched by
   address; CSV adapter works offline). ✅
3. `npm run dev` opens a page where moving any slider updates the leaderboard and charts with no
   reload, and the as-of scrubber changes scores using only data up to that date. ✅
4. Exported preset JSON round-trips (import reproduces the same scores). ✅
5. Swapping `p` to 1.0 makes holdings linear, and raising `H` flattens the vote recency effect —
   both visibly. ✅
6. Missing data never improves a rank; a pillar with no data at all is excluded for everyone. ✅
7. A backfill shorter than `T` does not distort TWAB, and the shortfall is surfaced. ✅

### Known limitations

- **Community coverage — a roster-generation problem.** 1 of 50 delegates matches HighSignal,
  because only 2 of 191 users expose an address. Under `missingPolicy: 'zero'` the remaining 49
  score 0 on community — correct in principle, but currently reflecting a data-plumbing gap rather
  than inactivity. **Do not give this pillar real weight until coverage improves.** The fix belongs
  upstream in how the roster is generated (§3.3): carrying an explicit community identity per
  delegate would make matching declared rather than discovered. A handle-based fallback inside the
  pipeline would raise coverage to 7 of 50 but risks mis-attribution on a handle collision, so it is
  deliberately not implemented.
- **No delegation start date.** Delegates are scored on proposals that closed before they became a
  delegate. Fixing this needs a per-delegate delegation-start timestamp (available from the Gnosis
  delegation API / on-chain delegation events) to clamp the proposal window.
- **`minmax` degenerates on sparse coverage.** With one measured delegate the range is zero; with
  two, they map to 0 and 100. It also maps the lowest measured delegate to 0, indistinguishable
  from an imputed 0. Prefer `native`.

---

## 9. Notes for the builder

- Treat `scoring-core` as the single source of truth for the math; the UI and collector must not
  re-implement formulas.
- Keep external calls resilient (retry/backoff) and cached (block-by-date, proposal list).
- Fail fast, naming the config field, when `ARCHIVE_RPC_URL` or `CSSV_ADDRESS` is missing — never
  silently drop the cSSV component.
- Distinguish *unmeasured* from *measured zero* everywhere. Both bugs found in review — TWAB
  zero-filling uncollected days, and per-delegate pillar exclusion — were the same mistake in
  different clothes.
- Do not require any DAOx app code to run; this tool is self-contained but mirrors DAOx config.

### Porting to production

The simulator is deliberately a superset. A production implementation should:

1. Take `scoring-core/` essentially as-is — it is I/O-free and framework-free.
2. Fix `missingPolicy` to `'zero'`; drop the `'exclude'` lever.
3. Persist the same audit columns (§5.4) so any score can be independently recomputed.
4. Ratify parameters from an exported preset (`npm run dev` → Export) rather than hardcoding.
5. Keep the pillar-level "source not configured" degradation — it is what lets the leaderboard
   ship before community coverage is solved.
6. Consume the delegate roster as an input on the same contract (§3.3). Production and simulator
   should read the *same* roster artifact, so a score can be reproduced from a known input set.
