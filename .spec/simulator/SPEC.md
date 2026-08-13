# Spec: Delegate Score Simulation Engine

A standalone tool that **collects every Delegate Score input over time**, **recomputes the score
in-browser as of any historical date**, and lets the DAO **tune every parameter** with live
sliders and charts — so the model can be calibrated against real data before it is ratified.

It implements the three-pillar **Delegate Score** defined in
`.spec/proposals/delegation-score-proposal.md`. Read that first: it explains *why* the model has
this shape. This document defines *exactly* what a production implementation must compute.

> **Status:** implemented and verified against live data sources.
> **§4 and §5 are normative** — a production implementation must reproduce them exactly.

---

## 1. Goal & scope

- **Collect** a time series of every pillar input for the delegates named in an externally
  supplied roster (§3.3): on-chain balances, Snapshot vote history, HighSignal community scores.
- **Simulate** the overall score and each pillar sub-score **as of any historical date**, using
  only data available up to that date.
- **Tune** every parameter and see the leaderboard and charts update instantly.
- **Export** the chosen configuration as JSON so the production implementation consumes the same
  numbers the DAO ratified.

Out of scope: writing scores on-chain, authentication, multi-user state.

---

## 2. Architecture

```
collector (Node/tsx) ──writes──▶ dataset (SQLite + JSON) ──read──▶ simulator UI (Vite + React)
        │                                                              │
        └───────────────── scoring-core (pure TS, no I/O) ─────────────┘
```

- **`scoring-core/`** — the formulas. Pure, no I/O, unit tested. Imported by both sides, so the
  math exists **exactly once**. Neither the UI nor the collector may re-implement a formula.
- **`collector/`** — `tsx` scripts that backfill time-series data into `data/sim.sqlite` and emit
  `data/dataset.json`.
- **`ui/`** — a Vite + React single-page app that loads the dataset and recomputes everything
  in-browser on every parameter change.

**Stack:** TypeScript throughout. UI: Vite + React + Recharts. Storage: SQLite via
`better-sqlite3`.

---

## 3. Configuration

### 3.1 Derived (defaults in `config.ts`)

| Key | Value |
|---|---|
| Snapshot space | `mainnet.ssvnetwork.eth` |
| Snapshot GraphQL API | `https://hub.snapshot.org/graphql` |
| SSV ERC-20 (chain 1, 18 dec) | `0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54` |
| cSSV ERC-20 (chain 1, 18 dec) | `0xe018D31F120A637828F46aFD6c64EC099d960546` |
| cSSV deployment block | `24719189` — earlier dates legitimately have cSSV = 0 |
| Gnosis delegation API | `https://delegate-api.gnosisguild.org/api/v1` |
| HighSignal API | `https://app.highsignal.xyz/api/users` — params `apiKey`, `project`, `page` |
| Backfill length | `240` days (`BACKFILL_DAYS`) |
| ETH-communities source projects | `HIGHSIGNAL_ETH_PROJECTS` — comma-separated, empty by default |
| ETH-communities minimum signal tier | `mid` (`HIGHSIGNAL_ETH_MIN_SIGNAL`; one of `low`/`mid`/`high`) |

> **Holdings base = SSV `balanceOf` + cSSV `balanceOf`, counted 1:1.** This matches the proposal's
> `H(t) = balance_SSV(t) + balance_cSSV(t)`. Nothing else is included.

### 3.2 Required (env, never hardcoded)

| Key | Notes |
|---|---|
| `ARCHIVE_RPC_URL` | Ethereum **archive** node. Needed to read `balanceOf` at historical blocks. |
| `HIGHSIGNAL_API_KEY` | Auth for HighSignal. **Also gates address visibility** — see §6.3. |

The collector fails fast, naming the field, if either is missing or malformed. `npm run doctor`
verifies the RPC can actually serve the required history before a long backfill.

### 3.3 Delegate roster — an external input

`data/delegates.csv` defines **who is scored**. It is produced **outside this pipeline** and
consumed here as a plain input: the collector reads it, validates it, and scores exactly what it
is given. Its provenance is deliberately out of scope.

That separation matters. Roster generation controls how delegates are **discovered,
identity-mapped and included**, and is expected to change independently of the scoring model.
Nothing downstream may assume where the file came from, that it is complete, or that it is stable
between runs.

**Input contract (v1):**

| Column | Required | Meaning |
|---|---|---|
| `address` | yes | Ethereum address. The join key for balances, votes and community matching. |
| `forumHandle` | no | Governance-forum identity. Not currently used for matching. |
| `discordUsername` | no | Discord identity. Not currently used for matching. |
| `displayName` | no | Leaderboard label; falls back to `forumHandle`, then the address. |

Validation on load, all normative:

- `address` is lowercased; matching everywhere is case-insensitive.
- A malformed `address` is a **hard error** naming the row — a silently skipped delegate is a
  silently missing score.
- Duplicate addresses collapse to the first occurrence.
- Empty optional fields are permitted and common; they must never cause a row to be dropped.
- An empty roster is a hard error.
- Unknown columns are ignored, so the contract can grow without breaking existing rosters.

---

## 4. The score — normative algorithm

All functions are pure. All dates are UTC `YYYY-MM-DD`. Every value is *as of the simulated
date*: **nothing after `asOf` may influence a result.**

### 4.1 Parameters

Six numbers and three modes. Every one is a governance lever.

| Parameter | Default | What it means | Raising it |
|---|---|---|---|
| `weights.community` | **3** | Weight of the community pillar | Community matters more |
| `weights.holdings` | **3** | Weight of the holdings pillar | Stake matters more |
| `weights.votes` | **10** | Weight of the participation pillar | Voting matters more |
| `holdings.ref` (`HOLD_REF`) | **10,000** | Time-weighted holding that scores 100 | Harder to score well on stake |
| `holdings.concavity` (`p`) | **0.5** | Whale-flattening strength (0.5 = square root, 1.0 = linear) | Less flattening; closer to plutocracy |
| `holdings.windowDays` (`T`) | **90** | Days of balance history averaged | Slower to reward new stake |
| `votes.halfLifeDays` (`H`) | **90** | Days for a vote's weight to halve | Old votes keep counting |
| `votes.windowN` (`N`) | **10** | How many recent closed proposals count | Longer participation record |
| `community.mode` | `native` | How HighSignal's score maps to 0–100 | — |
| `holdings.mode` | `power` | `power` (recommended) or `log` (over-flattens) | — |
| `missingPolicy` | `zero` | How a delegate absent from a live pillar is scored | — |

A weight of **0 switches a pillar off** for everyone — that is how a pillar ships dark.

> **Two deliberate departures from the proposal text.** The proposal states `T = 180` and `N = 5`.
> This spec ratifies **`T = 90`** and **`N = 10`**. See §4.3 and §4.4 for what each changes.

### 4.2 Pillar 1 — Community Contribution

**In one sentence:** use the delegate's HighSignal score, which is already a 0–100 index.

```
S_community = clamp(hs, 0, 100)                     // 'native' — the default
            = 100 · min(1, hs / refValue)           // 'refcap'
            = 100 · (hs − min) / (max − min)        // 'minmax', over delegates WITH data
                                                    //   → 100 if max = min and hs > 0, else 0
```

`hs` is the **most recent HighSignal observation dated ≤ `asOf`**. Never interpolated, never
filled forward from the future. `null` if the delegate has no observation at or before `asOf`.

Use `native`. The other two modes exist to demonstrate why they are worse (§10).

### 4.3 Pillar 2 — Token Holdings

**In one sentence:** average the delegate's SSV + cSSV over the last `T` days, then flatten the
curve so whales cannot buy proportional influence.

```
Step 1  daily(day) = ssvErc20 + cssv          carried forward from the last sample ≤ day, else 0
Step 2  window     = [asOf − T + 1, asOf] ∩ COVERAGE          // T = 90 days
        TWAB       = mean(daily(day) for day in window)
Step 3  S_holdings = 100 · min(1, (TWAB / HOLD_REF) ^ p)      // 'power' — the default
                   = 100 · min(1, ln(1+TWAB) / ln(1+HOLD_REF))// 'log'
```

where `COVERAGE = [min, max]` over all collected balance dates, **dataset-wide**.

At the defaults (`HOLD_REF = 10,000`, `p = 0.5`) this is just `100 × √(TWAB / 10,000)`, capped at
100:

| TWAB | 100 | 1,000 | 2,500 | 10,000 | 100,000 | 1,000,000 |
|---|---|---|---|---|---|---|
| **S_holdings** | 10 | 31.6 | 50 | 100 | 100 | 100 |

Four rules that are easy to get wrong and are **normative**:

1. **The window is intersected with collected coverage.** Averaging over uncollected days divides
   by a period that was never measured. With a 5-day backfill and `T = 90`, a steady 12,000-token
   holder would otherwise read as TWAB 667 and score 26 instead of 100.
2. **Coverage is dataset-level, not per-delegate.** Every delegate is averaged over the same days,
   so a delegate with a shorter history gains no advantage.
3. **Zeros must be recorded, not assumed.** The collector writes a row for every delegate on every
   collected day, so "held nothing then" is a stored fact. This is what preserves the
   anti-flash-loan property: recorded zeros still dilute a late purchase.
4. **`TWAB = null`** when `asOf` precedes all collected data, or the delegate has no balance rows.
   That is *unmeasured*, which is distinct from a measured zero (§4.5). Beyond the last collected
   day, TWAB is evaluated at that day rather than extrapolated.

The window is **exactly `T` days**, inclusive of `asOf` (`[asOf − T + 1, asOf]`).

> **On `T = 90` rather than 180.** Time-weighting exists to give tokens acquired just before a
> vote near-zero weight. At `T = 90` a one-day-old purchase still carries only **1/90** of the
> window — the anti-flash-loan property holds, at half the strength of `T = 180`. In exchange the
> pillar responds to genuine accumulation within a quarter rather than half a year, and needs
> half as much collected history before it reads true.

### 4.4 Pillar 3 — Snapshot Participation

**In one sentence:** of the last `N` proposals that closed, what share did the delegate vote on —
counting recent ones more.

```
asOfTs  = end of the asOf day (23:59:59 UTC)
window  = the N proposals with the largest endTs ≤ asOfTs      // N = 10
age_p   = (asOfTs − endTs_p) / 86400                           // in days
d_p     = 0.5 ^ (age_p / H)                                    // H = 90 → 90 days old, half weight
S_votes = 100 · Σ(voted_p · d_p) / Σ(d_p)
```

`voted_p ∈ {0, 1}`. The result is `null` when no proposal has closed at or before `asOf`.
Proposals that closed *after* `asOf` are never counted — a delegate is never penalised for a vote
that was not yet possible.

The choice of anchor (end of day vs midnight) does not affect the result: shifting every proposal
by the same amount scales numerator and denominator alike.

> **On `N = 10` rather than 5.** A 5-proposal window is small enough that one missed vote moves
> the pillar by ~20 points, which makes the highest-weighted pillar the noisiest. At `N = 10` the
> record is twice as long, while `H = 90` still ensures the most recent proposals dominate the
> denominator — so recency is preserved and single-vote noise is halved.

### 4.5 Missing data — pillar-level vs delegate-level

This is the part the proposal's "graceful degradation" clause does **not** settle, and getting it
wrong inverts the leaderboard.

```
live(i) = ∃ delegate : S_i(delegate) ≠ null         // is this source configured at all?

if S_i(d) = null:
    ¬live(i)                     → S_i(d) := null   // pillar off for EVERYONE
    live(i) ∧ policy = 'zero'    → S_i(d) := 0      // the default
    live(i) ∧ policy = 'exclude' → S_i(d) := null
```

- **Pillar-level absence** (no delegate has data) is the proposal's graceful degradation: the
  source is not configured, so the pillar is excluded for everyone and the score comes from the
  rest. Nobody is penalised.
- **Delegate-level absence** (the pillar is live, this delegate is missing from it) must **not**
  be excluded. Excluding it makes "no data" strictly better than "measured but low": with
  `w = {3,3,10}`, a delegate with no community profile scores `(3·50 + 10·88)/13 = 79.2` while an
  identical delegate measured at 8 scores `(3·8 + 3·50 + 10·88)/16 = 65.9`.

`'exclude'` remains selectable **in the simulator only**, so the failure mode can be demonstrated.
Production must use `'zero'`. Imputed values are flagged (`missing.<pillar> = true`) and **must be
displayed as imputed**, never as a measurement.

### 4.6 Identity collapse — one person, one row

A delegate may control several addresses. Where HighSignal reports linked addresses for a user,
those addresses are treated as **one identity**:

```
Group addresses by the linked sets HighSignal publishes (union-find).
Within each group, the CANONICAL delegate is the first to appear in roster order.
Every other roster address in that group is an ALIAS and is excluded from the leaderboard.
```

Without this, one person appears several times and — under §5 — draws delegated power once per
address. Aliases are excluded from ranking entirely, not merged: their balances and votes are not
summed into the canonical row.

### 4.7 Composite & ranking

```
DelegateScore = Σ(w_i · S_i) / Σ(w_i)     over pillars i where S_i ≠ null and w_i > 0
              = null                       if that denominator is 0
```

Every `S_i ∈ [0,100]`, so the result is automatically 0–100.

- Scores are stored and ranked **unrounded**; rounding is a display concern only.
- Ranking is by score descending, **ties broken by address ascending**, so the order is
  deterministic across runs and parameter changes.

---

## 5. Delegation allocation — normative

Separate from scoring, and computed from its result: how a pool of delegatable SSV/cSSV is spread
across delegates. Each delegate draws power from **at most one cohort**.

### 5.1 Cohort defaults

| Cohort | Share | Gate | Membership |
|---|---|---|---|
| **SSV Community** | **45%** | DelegateScore **> 20** | Automatic, from the leaderboard |
| **Verified Operators** | **25%** | min 5 nominations | Assigned |
| **Professional** | **10%** | min 1 nomination | Assigned |
| **Grant Recipients** | **15%** | min 5 nominations | Assigned |
| **Ethereum Communities** | **5%** | — | Automatic, from other HighSignal projects |

Total delegatable pool `D` = **200,000** SSV-equivalent by default. Shares sum to 100%.

### 5.2 Program cap

`D` is not a number the DAO picks — it is the sum of what token holders choose to auto-delegate,
and it only grows. The **program cap `C`** bounds the total voting power the program may ever
distribute:

```
effective   = min(D, C)                          // C = null → uncapped
voided      = max(0, D − C)
```

Default **`C` = 750,000** SSV-equivalent — 3.75× the ratified 200,000 pool, so it voids nothing today
and binds only once the program has nearly quadrupled. See §5.4 for the measured anchors.

- The cap applies to the **pool, before the split**. Every cohort budget, and therefore every
  delegate's power, is a share of `effective`.
- Power above the cap is **voided — permanently declined.** It is never assigned to a cohort, never
  votes, and is **not** the same as `unallocated`: the reserve sits *inside* the cap and remains the
  DAO's to assign, the voided excess does not exist as far as allocation is concerned.
- A binding cap **raises a warning**. It changes every delegate's power, so it is never silent.

### 5.3 Resolution and allocation

```
For each delegate on the leaderboard:
    pinned to a cohort           → that cohort            (an explicit assignment always wins)
    else score > scoreThreshold  → SSV Community
    else address ∈ ethCommunity  → Ethereum Communities
    else                         → no cohort, no power

budget(c)    = pct(c)/100 × effective             // the CAPPED pool, per §5.2
perMember(c) = budget(c) / memberCount(c)         // 0 when the cohort is empty
unallocated  = effective − Σ budget(c) over non-empty cohorts
```

- **SSV Community takes precedence over Ethereum Communities** when a delegate qualifies for
  both. The threshold is **strictly greater than** (`score > 20`, not `≥`).
- A cohort below its minimum nominations **still allocates**, and raises a warning. Gating
  allocation on the minimum would silently withhold power; warning surfaces it instead.
- Percentages summing below 100 leave a **reserve** (`unallocated`); summing above 100 is
  permitted and flagged, since it is a configuration error the operator should see.
- Power is split **equally** within a cohort. A cohort's per-member power therefore falls as it
  grows — lowering the SSV Community threshold widens that cohort and dilutes each member.

### 5.4 Where `C` = 750,000 sits

**`C` = 750,000 is the DAO's own figure**, adopted from its analysis. This section records what that
level measures against, so the trade-off it embodies is explicit rather than implied.

Anchors are SSV's live Snapshot governance (`mainnet.ssvnetwork.eth`), over the last 60 closed
proposals as of 2026-08-13:

| Anchor | Value | The cap at 750,000 is |
|---|---|---|
| Ratified pool `D` | **200,000** SSV | **3.75×** — 550,000 of growth headroom before the cap binds |
| Current quorum | **303,829** SSV | **247%** — the program at cap exceeds quorum on its own |
| Median turnout, last 12 contested proposals | **426,878** SSV | **63.7%** of votes cast |
| Lowest turnout, last 12 | **368,801** SSV | 67.0% of votes cast |
| SSV total supply | **17,361,674** | 4.32% |
| TWAB of the entire 486-delegate roster | **555,251** SSV | 135% |

**What this level does bound.** It is a hard ceiling on program growth: the program can absorb 3.75×
its current delegation and no more, and the excess is voided rather than accumulating quietly.
Without it, a pool that only grows has no terminal size at all.

**What it does not bound.** At 750,000 the program is above quorum and above half of typical turnout —
and above the combined time-weighted holdings of the entire 486-delegate roster.
The two properties available at a lower cap — *cannot establish quorum alone*, *cannot hold a
blocking minority* — do **not** hold here. Whether that matters rests on an assumption this spec
cannot verify: that the ~30 delegates drawing power vote independently rather than as a bloc. The
cap bounds the *program*, not the correlation between the delegates it funds.

For reference, the levels at which those properties would hold:

| Property | Requires |
|---|---|
| Cannot establish quorum alone | `C` < 303,829, with headroom for a rising quorum (~250,000) |
| Cannot hold a ⅓ blocking minority at median turnout | `C` ≤ 213,439 |
| Cannot hold a ⅓ blocking minority at the weakest recent turnout | `C` ≤ 184,400 |

Quorum is dynamic and has risen 259,323 → 303,829 across the observed window, so these thresholds
move upward over time. Recomputing them is a one-query job against the Snapshot API; they should be
re-measured whenever the cap is revisited.

---

## 6. Data collection

The collector backfills history and can be re-run to append new days (idempotent upserts).
Already-collected days are skipped, so re-running is cheap.

### 6.1 Balances — archive RPC

For each delegate, for each day in the backfill range, read `SSV.balanceOf` and `cSSV.balanceOf`
at the block nearest that day's UTC midnight, batched via Multicall3. Store as decimal (18 dec).

Block-per-date is resolved by bracketing outward from the previous day's block and cached in
`block_cache`.

Failure handling is **three-way** and normative:

| Situation | Behaviour |
|---|---|
| Delegate holds nothing | `balanceOf` returns 0. Recorded as 0. **Not an error.** |
| Token has **no code** at that block (not yet deployed) | Recorded as 0, logged once per token per block. |
| Token **is** deployed but the read failed | **Abort**, naming the token and likely cause. |

A failed read is coerced to 0 **only** when the contract provably had no code at that block, which
makes 0 the truth. Everything else is surfaced — silently dropping cSSV would understate every
holder.

Two operational rules:

- **Transient failures must be retried** with backoff. Treat an all-failed batch whose contracts
  *do* have code as transient. Without this, one blip aborts an entire backfill.
- **JSON-RPC batching must stay off.** A throttled provider can return a malformed, id-less error
  blob that `viem` cannot pair to a request, so the call resolves **empty instead of throwing** —
  turning a rate limit into silently-written zero balances. Unbatched, the 429 surfaces as an HTTP
  status that retry logic can act on.

### 6.2 Votes — Snapshot GraphQL

Fetch all closed proposals of the space (`id, title, end`), then all votes by roster addresses via
`votes(where: { space, voter_in: [...] })`, paginated. Store proposals and
`(address, proposal_id, voted)`. No API key required.

### 6.3 Community — HighSignal

`GET https://app.highsignal.xyz/api/users?apiKey=<KEY>&project=ssv&page=N`, looping `page` from 1
to `maxPage`. Response: `{ data[], maxPage, totalResults, currentPage, resultsPerPage }`.

**Verified record schema:**

```jsonc
{
  "username": "…", "displayName": "…", "rank": 56, "score": 8,
  "signal": "high",
  "ethereumAddresses": ["0x2de6…"],                                  // NOT "addresses"
  "historicalScores": [{ "day": "2026-07-19", "totalScore": 7 }, …]  // ~360 days, newest first
}
```

Three findings that must carry into production:

1. **The field is `ethereumAddresses`, not `addresses`.** Reading the wrong key matches nobody and
   fails *silently*. Accept both spellings defensively.
2. **The API key gates address visibility, not just access.** An unauthenticated request still
   returns HTTP 200 with the full user list — but omits the addresses of users who shared them
   with the project. A missing key therefore looks like "nobody matches", never like an auth
   error. Warn explicitly when no user in the response exposes an address.
3. **`historicalScores` is a real backfill source.** ~360 daily observations on the same 0–100
   scale as `score` (the newest entry equals `score`). Ingest the whole series, so the community
   pillar has history from the first run rather than only accruing forward. Write today's row
   last, from the authoritative `score` field.

Addresses are returned EIP-55 checksummed; the roster is lowercase. Normalise both sides.
Matching is **by address membership** (`delegate.address ∈ user.ethereumAddresses`). A delegate
with no match gets a `null` community pillar, resolved by §4.5.

**The same endpoint serves two further purposes:**

- **Linked identities** — the *extra* addresses a matched user publishes, which drive §4.6.
- **Ethereum Communities cohort** — published addresses of users in *other* HighSignal projects
  (`HIGHSIGNAL_ETH_PROJECTS`) whose `signal` tier is at or above `HIGHSIGNAL_ETH_MIN_SIGNAL`
  (default `mid`). An absent or unrecognised tier counts as *below* every threshold, so a missing
  field never leaks voting power to an unqualified user. Other projects are public and **must be
  queried without the SSV key** — sending it returns 401.

> **Coverage is the binding constraint.** Only delegates who explicitly shared an address can be
> matched — currently **5 of 486** on the live roster. See §10.

### 6.4 Data model (SQLite)

```
delegates(address PK, forum_handle, discord_handle, display_name)
balances(address, date, ssv_erc20, cssv, PRIMARY KEY(address, date))
proposals(proposal_id PK, title, end_ts)
delegate_votes(address, proposal_id, voted INT, PRIMARY KEY(address, proposal_id))
highsignal_scores(address, date, score, hs_username, hs_rank, PRIMARY KEY(address, date))
eth_communities(address PK, project, hs_username)          -- rebuilt each run
identities(delegate, address, hs_username, PRIMARY KEY(delegate, address))  -- rebuilt each run
block_cache(date PK, block)
```

### 6.5 The dataset file

The collector emits `data/dataset.json`: the delegates plus every series above. It is **the whole
input** — the simulator recomputes every score in the browser from it, so collecting requires
credentials but *reading* the result requires none. One person collects; everyone else works from
the file.

Any dataset arriving from outside the collector is **validated before use** (`parseDataset`).
Validation is deliberately stricter than parameter-preset parsing: a preset is a policy choice, so
defaulting a missing key is helpful; a dataset is the *evidence*, and a half-parsed one produces a
leaderboard that looks authoritative and is wrong. Every problem is a hard failure naming the
offending field. Absent optional arrays (`ethCommunities`, `identities`) read as empty, so older
datasets still load.

---

## 7. Simulator UI

A single page, everything recomputed in-browser via `scoring-core` — no server round-trips.

- **Parameter panel** — all of §4.1, live. Sliders for `HOLD_REF`, `p` (0.3–1.0), `T` (1–365),
  `H` (7–720), `N` (1–50); mode selectors for community normalization, log holdings and
  missing-data policy.
- **Delegation panel** — the §5 pool, cohort shares, thresholds and minimums, with per-cohort
  member counts and warnings.
- **As-of scrubber** — every score computed using only data up to the chosen date.
- **Leaderboard** — ranked by DelegateScore, sortable by any pillar, TWAB or allocated power;
  searchable; filterable by cohort and minimum power; paginated. Imputed pillars are marked `n/a`,
  weight-0 pillars are dimmed, and each row can be pinned to a cohort.
- **Charts** — DelegateScore over time per delegate; pillar breakdown for the selected delegate as
  stacked **weighted contributions** (`w_i·S_i/Σw`), so the stack height *is* the DelegateScore.
- **Presets** — export/import/copy JSON, and reset to the ratified defaults. Scoring presets and
  delegation presets are exported separately and never mixed.
- **Dataset import** — a build with no bundled dataset opens on an import screen rather than
  failing. Imported datasets are held in IndexedDB on that device and are never uploaded.
- **Warnings** — when the TWAB window exceeds collected history, say so; that shortfall is
  otherwise invisible and silently understates holdings.

**Performance.** TWAB is served from per-delegate prefix sums built once at index time; community
lookup and proposal-window selection are binary searches; chart series are computed at deferred
priority so the leaderboard repaints first. A naive per-day walk was ~100× slower and unusable at
roster scale.

---

## 8. Repo layout & commands

```
delegate-score-sim/
  config.ts                 # derived + required config, fail-fast validation
  scoring-core/             # pure formulas + unit tests (§4, §5)
    community.ts holdings.ts votes.ts composite.ts delegation.ts
    simulate.ts params.ts dataset-io.ts dates.ts types.ts
  collector/
    collect-balances.ts     # archive-RPC historical balances
    collect-votes.ts        # Snapshot GraphQL vote history
    highsignal/             # HighSignal provider (scores, identities, ETH cohort)
    rpc.ts db.ts delegates.ts util.ts
    build-dataset.ts        # writes data/sim.sqlite + data/dataset.json
    doctor.ts               # archive-RPC / coverage diagnostics
    seed-demo.ts            # synthetic dataset for offline runs
  ui/                       # Vite + React app (§7)
  data/                     # delegates.csv (INPUT, externally generated)
                            # delegation-default.json (shipped cohort defaults)
                            # sim.sqlite, dataset.json (generated)
```

| Command | Purpose |
|---|---|
| `npm run collect` | Backfill/refresh dataset. Flags: `--days=N`, `--skip-balances`, `--skip-votes`, `--skip-highsignal` |
| `npm test` | scoring-core + collector unit tests |
| `npm run dev` | Launch the simulator UI |
| `npm run doctor` | Verify the archive RPC serves the needed history |
| `npm run seed:demo` | Synthetic dataset, no credentials required |
| `npm run typecheck` | `tsc --noEmit` across all three parts |

---

## 9. Acceptance criteria

1. `npm test` passes, reproducing the proposal's worked example (Alice → **80**) and the whale
   case (TWAB 1,000,000 → holdings 100). ✅ **147 tests**
2. `npm run collect` produces `data/dataset.json` with balances, votes and HighSignal series for
   every delegate in `delegates.csv`. ✅
3. `npm run dev` opens a page where moving any slider updates the leaderboard and charts with no
   reload, and the as-of scrubber recomputes using only data up to that date. ✅
4. Exported presets round-trip — re-importing reproduces identical scores. ✅
5. Setting `p = 1.0` makes holdings linear; raising `H` flattens vote recency. Both visibly. ✅
6. Missing data never improves a rank; a pillar with no data at all is excluded for everyone. ✅
7. A backfill shorter than `T` does not distort TWAB, and the shortfall is surfaced. ✅
8. Each delegate draws delegated power from at most one cohort, and a linked identity appears on
   the leaderboard exactly once. ✅

---

## 10. Known limitations

- **Community coverage — a roster-generation problem.** **5 of 486** delegates match HighSignal,
  because only a handful of users have shared an address. Under `missingPolicy: 'zero'` the rest
  score 0 on community — correct in principle, but currently reflecting a data-plumbing gap rather
  than inactivity. **Do not give this pillar real weight until coverage improves.** The fix
  belongs upstream in roster generation (§3.3): carrying an explicit community identity per
  delegate would make matching *declared* rather than *discovered*. A handle-based fallback inside
  the pipeline would raise coverage but risks mis-attribution on a handle collision, so it is
  deliberately not implemented.
- **No delegation start date.** Delegates are scored on proposals that closed before they became a
  delegate. Fixing this needs a per-delegate delegation-start timestamp (available from the Gnosis
  delegation API / on-chain delegation events) to clamp the proposal window.
- **`minmax` degenerates on sparse coverage.** With one measured delegate the range is zero; with
  two, they map to 0 and 100. It also maps the lowest measured delegate to 0, indistinguishable
  from an imputed 0. Prefer `native`.
- **Identity collapse only sees what HighSignal publishes.** A delegate operating several
  addresses without linking them there is still several rows, and would draw cohort power once per
  address.

---

## 11. Notes for the builder

- Treat `scoring-core` as the single source of truth for the math. The UI and collector must not
  re-implement a formula — that is what makes a preset exported from the UI trustworthy as a
  production config.
- Keep external calls resilient (retry/backoff) and cached (block-by-date, proposal list).
- Fail fast, naming the config field, when `ARCHIVE_RPC_URL` or `CSSV_ADDRESS` is missing — never
  silently drop the cSSV component.
- **Distinguish *unmeasured* from *measured zero* everywhere.** Both bugs found in review — TWAB
  zero-filling uncollected days, and per-delegate pillar exclusion — were this same mistake in
  different clothes.

### Porting to production

The simulator is deliberately a superset. A production implementation should:

1. Take `scoring-core/` essentially as-is — it is I/O-free and framework-free.
2. Fix `missingPolicy` to `'zero'` and drop the `'exclude'` lever.
3. Persist the same audit columns (§6.4) so any score can be independently recomputed, including
   how many days the TWAB actually averaged over.
4. Load parameters from an exported preset rather than hardcoding them, so the numbers in
   production are provably the numbers the DAO ratified.
5. Keep the pillar-level "source not configured" degradation — it is what lets the leaderboard
   ship before community coverage is solved.
6. Consume the delegate roster as an input on the same contract (§3.3). Production and simulator
   should read the *same* roster artifact, so any score can be reproduced from a known input set.
