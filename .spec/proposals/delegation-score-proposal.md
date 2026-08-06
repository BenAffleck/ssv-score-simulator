# DAO Proposal: Delegate Score — A Three-Pillar Scoring Model for SSV Delegates

> **Status:** Draft for DAO vote — **Revision 3**
> **Module:** DAOx › DAO Delegates
> **Type:** Governance / scoring-methodology change
> **Author:** DAOx maintainers

> **What changed in Revision 3.** The model was calibrated against the full live roster using the
> simulator (`.spec/simulator/SPEC.md`). Revision 3 ratifies the calibrated numbers and adds the
> allocation rules that were previously undocumented:
>
> 1. **Two parameter defaults changed** after calibration: the holdings window `T` is **90 days**
>    (was 180) and the participation window `N` is **10 proposals** (was 5). Both are explained
>    where they appear.
> 2. **Delegation allocation is now specified** — how a delegatable pool is split across five
>    cohorts, and how a delegate's score routes them into one (new section).
> 3. **One person, one row.** Delegates operating several linked addresses are collapsed to a
>    single leaderboard identity, so nobody is ranked or funded twice (new section).
> 4. **Coverage figures updated** to the current roster: **5 of 486** delegates can be matched to
>    a community score. The recommendation to launch Pillar 1 at weight 0 is unchanged, and
>    strengthened.

---

## Summary

This proposal adopts a transparent, DAO-owned **Delegate Score** as the primary ranking for SSV
Network delegates: a weighted average of **three independent pillars**, each measuring a different
dimension of what makes a good delegate.

| Pillar | What it measures | Source |
|---|---|---|
| **Community Contribution** | Quality of contributions across **Discord + Forum** | HighSignal (`app.highsignal.xyz`) |
| **Token Holdings** | Skin-in-the-game via SSV + cSSV **held over time** | On-chain balances, time-weighted |
| **Snapshot Participation** | Showing up to vote — with **recent** votes counting more | Snapshot proposals |

The result is a single number on a familiar **0–100** scale, computed from inputs the DAO
controls, stores, and can independently recompute.

**We are asking the DAO to adopt this Delegate Score, ratify its formulas, defaults and allocation
rules, and approve its ongoing operation.**

---

## Design Goals

A delegate score exists to answer one question: **how much should a token holder trust this
delegate with their voting power?** Three properties follow, and each becomes a pillar.

**1. Contribution should be measured by substance, not volume.** Counting forum posts or Discord
messages rewards *quantity*, and cannot tell a thoughtful governance analysis from a stream of
one-liners. → **Pillar 1.**

**2. Commitment should count — without becoming purchasable.** A delegate with a real position has
something at stake. But adding token weight naïvely reintroduces plutocracy, so stake must be a
signal *without* becoming a purchase of influence, and must reflect **sustained** holding rather
than a balance assembled the day before a vote. → **Pillar 2**, time-weighted, flattened, capped.

**3. Participation should reflect the present.** A delegate active a year ago and silent since
should not keep a high score. → **Pillar 3**, recency-weighted.

### Constraints on the design

- **One number, 0–100**, explainable in a sentence, with every pillar separately visible.
- **Every input stored and auditable**, so any published score can be independently recomputed.
- **Every constant a governance lever**, adjustable by vote without re-architecting anything.

---

## Who Is Scored — The Delegate Roster

The score is computed over a **roster** supplied to the pipeline as an input: delegate addresses
plus their community identities. The roster is produced by a separate, upstream process and is
**deliberately not part of the scoring methodology.**

- **The scoring pipeline does not decide who is a delegate.** It scores exactly the roster it is
  given.
- **Discovery, identity mapping and inclusion are a distinct concern**, free to evolve without
  re-ratifying the formulas below.
- **The roster is the leverage point for coverage.** Whether a delegate's community contribution
  can be measured at all depends on whether the roster carries an identity HighSignal recognises.

> **Governance note.** Changes to *how* the roster is generated do not require re-ratifying this
> proposal. A change that materially alters **who appears on the leaderboard** — eligibility rules,
> inclusion thresholds — is a governance decision and comes back to the DAO separately.

---

## The Delegate Score

Each pillar produces a sub-score on a common **0–100** scale. The overall score is their weighted
average:

```
DelegateScore = Σ(wᵢ × Sᵢ) / Σ(wᵢ)          for i ∈ {Community, Holdings, Votes}
```

At the default weights — **Community 3, Holdings 3, Votes 10** — that is simply:

```
DelegateScore = (3 × Community + 3 × Holdings + 10 × Votes) / 16
```

Because every Sᵢ is already 0–100, the result is automatically 0–100. A weighted average was
chosen over anything more elaborate because it is trivially explainable, trivially auditable, and
every term in it is a lever the DAO can turn.

The defaults weight **voting participation highest** — it is the most direct evidence of a
delegate doing the job they were delegated to do — with community contribution and holdings as
supporting signals at equal, moderate weight.

Scores are **stored and ranked unrounded**; rounding is a display choice. Ties break by delegate
address, so the published order is deterministic.

---

## Pillar 1 — Community Contribution

**What it measures:** the quality of a delegate's contributions across Discord and the governance
forum, as a single number from **HighSignal** — a community-analytics service that scores
substantive participation.

**How it is computed:** HighSignal already returns a **0–100** score. It is used directly.

```
S_community = the delegate's HighSignal score, clamped to 0–100
```

Using one external, substance-weighted index means we do not build and maintain a local
forum/Discord scoring pipeline, and we get a single figure rather than several crude proxies.
Rescaling modes (min–max, reference cap) exist as levers but are **not recommended** — see
"Open Questions".

### Integration

| Item | Value |
|---|---|
| Endpoint | `GET https://app.highsignal.xyz/api/users?apiKey=<KEY>&project=ssv&page=N`, paginated |
| Score field | `score` — already a **0–100** index, used natively |
| Identity link | `ethereumAddresses[]`; a delegate matches when their address appears there |
| History | `historicalScores[] = { day, totalScore }` — **~360 daily observations**, same scale |

Two operational facts that shape what this pillar can deliver today:

1. **The API key gates *visibility*, not just access.** An unauthenticated request still returns
   the full user list, but **omits the Ethereum addresses** of users who shared them. A
   misconfigured key therefore presents as "no delegate matches" rather than an auth error.
2. **Matching depends on delegates opting in.** Only delegates who have explicitly linked an
   address in HighSignal can be scored — currently **5 of 486** on the roster.

The `historicalScores` series is a material improvement: this pillar has ~12 months of real
history immediately, rather than only accruing forward from the day it is switched on.

> **Recommendation — launch this pillar at weight 0.** At ~1% coverage, a live community pillar
> would score the other 99% of delegates as 0 for a reason that is administrative, not behavioural.
> Ratify the methodology now; raise the weight by follow-up vote once coverage is solved — most
> likely in roster generation rather than in the scoring pipeline.

---

## Pillar 2 — Token Holdings (the whale-flattened pillar)

**What it measures:** how much SSV + cSSV a delegate holds, **and for how long** — while
deliberately **flattening the curve so large holders cannot buy proportional influence.**

`cSSV` (Composable-SSV) is the liquid ERC-20 representation of staked SSV. It is 1:1 with SSV and
retains full governance power, so the two are summed at parity.

Three steps.

### Step 1 — Average the balance over time

```
H(t) = balance_SSV(t) + balance_cSSV(t)
TWAB = the average of H(t) over the last T days          (default T = 90)
```

In practice: the average of daily balance snapshots across the window.

**Why time-weight?** It rewards *sustained* holders and gives tokens acquired moments before a
vote — or flash-loaned — near-zero weight, because their holding duration in the window is
near-zero. At `T = 90`, a purchase made yesterday counts for **1/90th** of the window. This
neutralises last-minute accumulation and governance-capture-by-loan.

**The window is intersected with the history actually collected.** Averaging over days we never
measured would divide by a period that does not exist: with only 5 days of snapshots and `T = 90`,
a steady 12,000-token holder would compute to a TWAB of 667 and score 26 instead of 100. Coverage
is assessed **across the whole delegate set**, not per delegate, so a delegate with a shorter
history gains no advantage.

The rule that makes this safe: **a zero must be recorded, not assumed.** The snapshot job stores a
row for every delegate on every collected day, so "held nothing then" is a stored fact — and
recorded zeros still dilute a late purchase exactly as intended.

### Step 2 — Flatten the curve

```
raw = TWAB ^ p          with p = 0.5 (square root) as the default
```

A concave transform means influence grows far slower than balance: **100× the tokens earns only
10× the raw score.** Square root specifically:

- vs **linear** (`p = 1`) — pure plutocracy; a 100× whale gets 100× the weight.
- vs **logarithmic** — over-flattens (stake becomes almost meaningless) and, in the
  governance-attack literature, is *strictly worse* than square root against wallet-splitting.

Square root is the standard, well-understood middle ground — the same √n relationship used by
quadratic voting.

### Step 3 — Cap it at a reference holding

```
S_holdings = 100 × min( 1, √(TWAB / HOLD_REF) )          with HOLD_REF = 10,000
```

`HOLD_REF` is the holding that earns full marks. The `min(…, 1)` is an **absolute ceiling** on top
of the concave curve — double protection, so ultra-whales cannot exceed a normal committed holder.

| Time-weighted holding | vs reference | **S_holdings** |
|---|---|---|
| 100 | 1% | 10 |
| 1,000 | 10% | 31.6 |
| 2,500 | 25% | 50 |
| 10,000 | 100% | 100 |
| 100,000 | 1,000% | 100 (capped) |
| 1,000,000 | 10,000% | 100 (capped) |

> A delegate holding **400× more** tokens (2,500 → 1,000,000) sees their holdings sub-score only
> **double** (50 → 100). And since Holdings is one weighted pillar of three, its effect on the
> final score is bounded further. Whales get *a* voice, not *the* voice.

### Why concave dampening is sound *here*

Recent research ("Concave is the New Linear", arXiv 2605.18990) proves that square-root/log
dampening cannot stop plutocracy **on permissionless, pseudonymous voting**, because a whale can
split tokens across many wallets to recover linear power. Its recommended remedy is to use concave
dampening **only as one component of a composite mechanism that also includes an identity layer.**

That is exactly this design: the Holdings score attaches to a **vetted delegate identity**, not to
arbitrary wallets — so splitting tokens across wallets does not help a single delegate — and it is
**one of three pillars**, alongside identity-bound community and voting signals.

---

## Pillar 3 — Snapshot Participation (recency-weighted)

**What it measures:** whether a delegate **actually votes — and recently.**

Take the **N most recent proposals that had already closed** on the evaluation date. Each carries a
weight that halves every `H` days:

```
dₚ      = 0.5 ^ (ageₚ / H)                     H = 90 days, ageₚ in days
S_votes = 100 × Σ(votedₚ × dₚ) / Σ(dₚ)         votedₚ = 1 if they voted, else 0
```

Defaults: **N = 10 proposals, H = 90 days.** A proposal that closed today counts fully; one from
90 days ago counts half; one from 180 days ago, a quarter.

Proposals that closed after the evaluation date are never counted, so a delegate is never
penalised for a vote that was not yet possible.

Recent proposals dominate the denominator, so skipping the latest votes lowers the score even for a
delegate who voted often in the past — while voting on everything still yields 100.

> **Known gap.** A delegate is currently scored on proposals that closed *before they became a
> delegate*. Closing this requires a per-delegate delegation-start date (available from the Gnosis
> delegation API / on-chain delegation events) to clamp the window.

---

## One Person, One Row

A delegate may operate several addresses. Where HighSignal reports linked addresses for a user,
those addresses are treated as **one identity**: the first to appear in the roster is the one
ranked, and the rest are excluded from the leaderboard.

Without this, one person appears several times — and, under the allocation rules below, would draw
delegated voting power **once per address**.

This only catches links the delegate has published. A delegate operating several addresses without
linking them is still several rows; closing that gap belongs to roster generation.

---

## Missing Data

Two different situations, which must be handled **differently**:

| Case | Rule | Rationale |
|---|---|---|
| **The source is not configured** — no delegate has data for that pillar | Excluded from the weighted average **for everyone**; score computed from the remaining pillars | Graceful degradation. Nobody is advantaged or penalised. |
| **The pillar is live, but one delegate is missing from it** | That delegate scores **0** on the pillar | Otherwise missing data outranks a measured low score |

**Why the second rule matters.** If an absent pillar were simply dropped from an individual's
average, then with `w = {3,3,10}`:

```
Delegate with no community profile : (3×50 + 10×88) / 13 = 79.2
Delegate measured at community 8   : (3×8 + 3×50 + 10×88) / 16 = 65.9
```

Having no data would be worth **13 points more** than being measured and scoring poorly — an
incentive to avoid being measured, which is the opposite of what a contribution score should
reward.

Imputed zeros must be **displayed as imputed**, never as a measurement, so a delegate can see that
a 0 means "we have no record of you" and act on it.

---

## Worked Example

Delegate *Alice*, at the default weights (`Σw = 16`) and `HOLD_REF = 10,000`:

| Pillar | Raw | Sub-score |
|---|---|---|
| Community | HighSignal score 82 | **82** |
| Holdings | TWAB 2,500 | `100 × √(2500/10000)` = **50** |
| Participation | voted 4 of the last 5 closed proposals, missing the oldest; ~30 days apart | **88.05** |

```
DelegateScore = (3×82 + 3×50 + 10×88.05) / 16
              = (246 + 150 + 880.5) / 16
              = 1276.5 / 16
              = 79.78  →  displayed as 80
```

> Sub-scores enter the average **unrounded** — 88.05, not 88. Rounding intermediates first would
> give 79.75 here, which displays the same but is not the number the engine ranks on.

**Recency in action:** the same 4-of-5 participation scores **88** when the *oldest* proposal was
skipped, but only **~70** if the *most recent* was skipped instead — flat counting would give 80
either way. A delegate who stops voting sees this pillar decay toward 0 over a few half-lives, even
if their historical record was strong.

**Whale contrast:** a delegate identical to Alice but holding a time-weighted **1,000,000** tokens
(400× more) scores 100 on Holdings instead of 50 — raising their overall score by only
`3 × (100−50) / 16 ≈ 9.4 points`. Four hundred times the stake buys under ten points.

> Alice's example has five closed proposals, so it reads the same at `N = 10` as at `N = 5`: the
> window takes every proposal available. The vote sub-score also depends on proposal *spacing*;
> 30-day spacing is the value consistent with both figures quoted here (88.05 and 69.88), and is
> what the reference implementation tests against.

---

## Delegation Allocation

The score exists to route voting power. A delegatable pool is split across **five cohorts**, and
each delegate draws from **at most one**.

| Cohort | Share | Who is in it |
|---|---|---|
| **SSV Community** | **45%** | Automatic: any delegate scoring **above 20** |
| **Verified Operators** | **25%** | Nominated (minimum 5) |
| **Professional** | **10%** | Nominated (minimum 1) |
| **Grant Recipients** | **15%** | Nominated (minimum 5) |
| **Ethereum Communities** | **5%** | Automatic: high-signal contributors from other Ethereum communities |

Default pool: **200,000 SSV-equivalent.** Shares sum to 100%.

**How power is assigned.** A delegate explicitly nominated to a cohort goes there. Otherwise, a
score above the threshold puts them in SSV Community; failing that, membership of another Ethereum
community puts them in Ethereum Communities; failing both, they receive nothing. **Within a
cohort, the budget is split equally.**

```
cohort budget      = share × 200,000
power per delegate = cohort budget / number of delegates in that cohort
```

So if 100 delegates clear the threshold, SSV Community's 90,000 is split 900 each. **Per-member
power falls as a cohort grows** — lowering the score threshold widens the cohort and dilutes
everyone in it. That trade-off is the point of making the threshold a lever.

A cohort below its minimum nominations still allocates, but raises a warning: withholding power
silently would be worse than surfacing an under-filled cohort. Shares summing below 100% leave the
remainder as an unallocated reserve.

---

## Parameters & Governance Levers

Every constant is a lever the DAO ratifies now and can adjust later by vote.

| Parameter | Default | What it governs |
|---|---|---|
| Pillar weights (Community / Holdings / Votes) | **3 / 3 / 10** | Relative pillar influence |
| Community: normalization | native 0–100 | How the HighSignal score maps to 0–100 |
| Holdings: lookback window `T` | **90 days** | How much balance history is averaged |
| Holdings: concavity `p` | 0.5 (square root) | Whale-dampening strength (1.0 = linear) |
| Holdings: reference cap `HOLD_REF` | 10,000 SSV-eq | Holding that scores 100 |
| Holdings: cSSV : SSV ratio | 1 : 1 | Parity of staked vs liquid token |
| Participation: proposal window `N` | **10** | How many recent proposals count |
| Participation: recency half-life `H` | 90 days | How fast past votes decay |
| Missing data: per-delegate policy | count as 0 | How a delegate absent from a live pillar is scored |
| Delegation: total pool | 200,000 | Voting power to distribute |
| Delegation: cohort shares | 45 / 25 / 10 / 15 / 5 | Split across the five cohorts |
| Delegation: SSV Community threshold | score > 20 | Who qualifies automatically |

### Notes on the two calibrated defaults

**`T = 90` rather than 180.** Time-weighting exists to give tokens acquired just before a vote
near-zero weight. At 90 days a one-day-old purchase still carries only 1/90 of the window, so the
anti-flash-loan property holds — at half the strength of a 180-day window. In exchange the pillar
responds to genuine accumulation within a quarter rather than half a year, and needs half as much
collected history before it reads true.

**`N = 10` rather than 5.** With a 5-proposal window, one missed vote moves the pillar by ~20
points, making the highest-weighted pillar also the noisiest. At 10 the record is twice as long,
while the 90-day half-life still lets recent proposals dominate — recency is preserved and
single-vote noise is halved.

A calibration simulator (`.spec/simulator/SPEC.md`) lets any of these be varied against real
collected data, and exports the chosen configuration as JSON for the production implementation to
consume — so the numbers that ship are provably the numbers that were ratified.

---

## Operations & Cost

- **Delegate roster:** supplied as an input by an upstream process. The scoring pipeline reads it
  and does not modify it.
- **Community Contribution:** periodic pull from the HighSignal API. No local forum/Discord
  pipeline needed; `historicalScores` provides ~360 days of backfill on first run.
- **Holdings:** a daily job snapshots each delegate's SSV + cSSV balance into a snapshot table;
  TWAB is the windowed average. The scoring window is 90 days; the reference collector backfills
  240 days so scores can be recomputed as of any recent date. Historical reads require an
  **archive** node.
- **Snapshot participation:** fetched from Snapshot via GraphQL; free, no key.
- **Auditability:** every pillar's inputs and sub-score are stored, so any Delegate Score can be
  independently recomputed. Stored inputs include how many days the TWAB actually averaged over,
  so a score computed on partial history is self-evidently so.

---

## Open Questions

Deliberately unresolved, and recommended as follow-up work rather than blockers:

1. **Community-score coverage (highest priority).** At 5 of 486, Pillar 1 cannot carry real weight.
   This is primarily a **roster-generation** problem: the pipeline can only match the identities the
   roster gives it. Options include a delegate-onboarding step that requires linking an address in
   HighSignal, or carrying an explicit community identity in the roster contract. A handle-based
   fallback would raise coverage but risks attributing another person's score on a handle collision.
   **Recommended: fix coverage upstream in roster generation; do not weaken identity matching in the
   scoring pipeline.**
2. **Delegation start date**, to stop scoring delegates on proposals predating their delegacy.
3. **Community normalization mode.** `native` is recommended. `minmax` degenerates badly on sparse
   coverage and maps the lowest measured delegate to 0, making them indistinguishable from a
   delegate with no record.
4. **Unlinked addresses.** Identity collapse only sees links a delegate has published on
   HighSignal. Delegates operating unlinked addresses still appear — and would be funded — more
   than once.

---

## What You Are Voting On

By approving this proposal, the DAO agrees to:

1. **Adopt the DAO-owned three-pillar Delegate Score** as the primary delegate ranking.
2. **Ratify the pillar methodology** — Community Contribution (HighSignal), Token Holdings
   (time-weighted + square-root + reference cap), and Snapshot Participation (recency-weighted).
3. **Ratify the defaults and reference constants** in "Parameters & Governance Levers", including
   the calibrated `T = 90` and `N = 10`.
4. **Ratify the missing-data rules** — pillar-level absence excluded for everyone; delegate-level
   absence scored 0 and displayed as imputed.
5. **Ratify the delegation allocation rules** — the five cohorts, the 45/25/10/15/5 split, the
   score threshold of 20, and equal splitting within a cohort.
6. **Launch Pillar 1 at weight 0**, to be raised by follow-up vote once community-score coverage
   is sufficient.
7. **Accept that the delegate roster is an external input** whose generation is a separate concern,
   on the understanding that changes materially altering *who* appears on the leaderboard come back
   to the DAO.
8. **Approve ongoing operation** — regular ingestion of each pillar's data and display of the
   resulting scores.
9. **Recognize all weights, windows, thresholds and caps as governance levers** — any future change
   requires a follow-up DAO vote.

---

## Appendix — References

- SSV Network — cSSV (Composable-SSV) staking: <https://ssv.network/cssv>
- HighSignal — community contribution scoring: <https://app.highsignal.xyz>
- *Concave is the New Linear: The Impossibility of Anti-Plutocratic DAO Governance* —
  <https://arxiv.org/html/2605.18990>
- *DAO voting mechanism resistant to whale and collusion problems* (Frontiers in Blockchain) —
  <https://www.frontiersin.org/journals/blockchain/articles/10.3389/fbloc.2024.1405516/full>
- *Balancing Security and Liquidity: A Time-Weighted Snapshot Framework for DAO Governance
  Voting* — <https://arxiv.org/pdf/2505.00888>

**Reference implementation & calibration tool:** `.spec/simulator/SPEC.md` — §4 and §5 are the
normative algorithm, including the missing-data, identity-collapse and allocation rules ratified
above.
