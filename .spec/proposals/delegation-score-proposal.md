# DAO Proposal: Delegate Score — A Three-Pillar Scoring Model for SSV Delegates

> **Status:** Draft for DAO vote — **Revision 2**
> **Module:** DAOx › DAO Delegates
> **Type:** Governance / scoring-methodology change
> **Author:** DAOx maintainers

> **What changed in Revision 2.** The methodology was implemented end-to-end and validated against
> live data (a calibration simulator, `.spec/simulator/SPEC.md`). Revision 2 pins down what
> Revision 1 deferred and corrects defects the implementation exposed:
>
> 1. **HighSignal integration is now specified**, not "to be confirmed" — endpoint, auth, field
>    names, scale, and a historical series we did not know existed (Pillar 1).
> 2. **Missing data is now specified.** Revision 1's "graceful degradation" clause was ambiguous
>    between *the source is off* and *this delegate has no data*. Read the second way, it made
>    having **no** community score rank **above** having a low one. Ratifying the distinction is
>    part of this vote (new section: "Missing Data").
> 3. **Time-weighting is defined against collected coverage**, so a short data history cannot
>    silently understate every delegate's holdings (Pillar 2, Stage A).
> 4. **Holdings base is SSV + cSSV only.** An interim implementation also summed an SSV vesting
>    contract; that is removed, restoring the formula in this document.
> 5. **The delegate roster is defined as an external input** with its own contract, rather than
>    being tied to any particular predecessor system (new section: "Who Is Scored").
> 6. **The score is specified on its own terms.** Revision 1 framed the design as a diff against
>    the previously used external score; that framing is dropped. This document now stands alone.

---

## Summary

This proposal adopts a transparent, DAO-owned **Delegate Score** as the primary ranking for SSV
Network delegates. It is a weighted, normalized composite of **three independent pillars**, each
measuring a different, complementary dimension of what makes a good delegate:

| Pillar | What it measures | Source |
|---|---|---|
| **Community Contribution** | Quality of contributions across **Discord + Forum**, as one score | HighSignal (`app.highsignal.xyz`) |
| **Token Holdings** | Skin-in-the-game via cSSV + SSV **held over time** | On-chain balances, time-weighted |
| **Snapshot Participation** | Showing up to vote — with **recent** votes counting more | Snapshot proposals |

The result is a single number on a familiar **0–100** scale, computed from inputs the DAO
controls, stores, and can independently recompute.

**We are asking the DAO to adopt this three-pillar Delegate Score, ratify its formulas and
default weights, and approve its ongoing operation.**

---

## Design Goals

A delegate score exists to answer one question: **how much should a token holder trust this
delegate with their voting power?** Three properties follow from that, and each becomes a pillar.

### 1. Contribution should be measured by substance, not volume

Counting forum posts or Discord messages rewards *quantity*. Such counters cannot tell a
thoughtful governance analysis from a stream of one-liners, and they fragment one thing —
community contribution — across several crude proxies. We want a single, substance-weighted
measure of whether a delegate actually helps the community reason about decisions.
→ **Pillar 1, Community Contribution.**

### 2. Commitment should count — without becoming purchasable

A delegate with a real position has something at stake, and that is genuine signal. But adding
token weight naïvely reintroduces plutocracy: a single large holder would dominate the ranking.
Stake must be a signal *without* becoming a purchase of influence, and it must reflect
**sustained** holding rather than a balance assembled the day before a vote.
→ **Pillar 2, Token Holdings** — time-weighted, concavely dampened, and hard-capped.

### 3. Participation should reflect the present

A delegate who was active a year ago and silent since should not keep a high score. Participation
is only meaningful as a statement about *current* engagement, so recent votes must count for more
than old ones.
→ **Pillar 3, Snapshot Participation** — recency-weighted.

### Constraints on the design

- **One number, 0–100**, explainable in a sentence, with every pillar separately visible so a
  delegate's position can be understood rather than merely observed.
- **Every input stored and auditable**, so any published score can be independently recomputed.
- **Every constant a governance lever**, adjustable by vote without re-architecting the system.

---

## Who Is Scored — The Delegate Roster

The score is computed over a **roster** supplied to the pipeline as an input: a list of delegate
addresses together with their community identities. The roster is produced by a separate,
upstream process and is **deliberately not part of the scoring methodology.**

That separation is intentional, and matters for governance:

- **The scoring pipeline does not decide who is a delegate.** It scores exactly the roster it is
  given, and makes no assumptions about where that roster came from.
- **Discovery, identity mapping and inclusion are a distinct concern.** How delegates are found,
  how their forum/Discord/on-chain identities are linked, and which of them qualify for inclusion
  can all evolve without touching — or re-ratifying — the formulas below.
- **The roster is the leverage point for coverage.** Whether a delegate's community contribution
  can be measured at all depends on whether the roster carries an identity the community-analytics
  source recognises. See "Open Questions".

The roster in use today is a point-in-time snapshot of the delegate set in the current system. It
should be treated as a starting input, not as a specification: it is expected to be regenerated,
and its generation refined, independently of this proposal.

> **Governance note.** Changes to *how* the roster is generated do not require re-ratifying this
> proposal. But a change that materially alters **who appears on the leaderboard** — eligibility
> rules, inclusion thresholds — is a governance decision and should be surfaced to the DAO
> separately.

---

## The Delegate Score

### Composite formula

Each pillar produces a sub-score on a common **0–100** scale. The overall Delegate Score is their
weighted average:

```
DelegateScore = Σ(wᵢ × Sᵢ) / Σ(wᵢ)          for i ∈ {Community, Holdings, Votes}

where each Sᵢ ∈ [0, 100] and wᵢ is the DAO-set weight for pillar i.
```

Because every Sᵢ is already normalized to 0–100, the result is automatically 0–100. A weighted
average was chosen over anything more elaborate because it is trivially explainable, trivially
auditable, and every term in it is a lever the DAO can turn.

Scores are **stored and ranked unrounded**; rounding to a whole number is a display choice only.
Ties are broken by delegate address so the published order is deterministic.

### Table 1 — The three pillars

| # | Pillar (Sᵢ) | Raw signal | Normalization to 0–100 | Default weight (wᵢ) |
|---|---|---|---|---|
| 1 | **Community Contribution** | HighSignal overall score (Discord + Forum) | Use native 0–100 index, else rescale (see Pillar 1) | 3 |
| 2 | **Token Holdings** | Time-weighted cSSV + SSV balance | Concave (√) + reference cap (see Pillar 2) | 3 |
| 3 | **Snapshot Participation** | Recent proposals voted on, **recency-weighted** | `100 × Σ(votedₚ·dₚ)/Σdₚ` (see Pillar 3) | 10 |

> The defaults weight **voting participation highest** — it is the most direct evidence of a
> delegate doing the job they were delegated to do — with community contribution and holdings as
> supporting signals at equal, moderate weight. **All weights are governance levers** to be
> ratified and adjustable by future vote (see "Parameters" and "What You Are Voting On").

---

## Pillar 1 — Community Contribution Score (HighSignal)

Measures the **quality of a delegate's contributions across both Discord and the governance
forum**, as a single number sourced from **HighSignal** (`app.highsignal.xyz`) — a
community-analytics service that scores substantive participation across our community's
channels.

Using one external, substance-weighted index means we do not need to build and maintain a local
forum/Discord scoring pipeline, and we get a single figure rather than several partial proxies.

- **Input:** the delegate's HighSignal overall score.
- **Normalization to 0–100:** HighSignal returns a native 0–100 score, used directly.
  Min–max and reference-cap rescaling remain available as levers but are **not recommended** —
  see "Open Questions".

### Integration (confirmed in Revision 2)

Revision 1 left the endpoint, authentication, response field and scale open. They are now
verified against the live API:

| Item | Value |
|---|---|
| Endpoint | `GET https://app.highsignal.xyz/api/users?apiKey=<KEY>&project=ssv&page=N`, paginated `1..maxPage` |
| Score field | `score` — already a **0–100** index, used natively |
| Identity link | `ethereumAddresses[]` on each user record; a delegate matches when their address appears there |
| History | `historicalScores[] = { day, totalScore }` — **~360 daily observations** on the same 0–100 scale |

Two operational facts the DAO should be aware of, because they shape what this pillar can
currently deliver:

1. **The API key gates *visibility*, not just access.** An unauthenticated request still returns
   the full user list, but **omits the Ethereum addresses** of users who shared them with the SSV
   project. A misconfigured key therefore presents as "no delegate matches" rather than as an
   authentication error.
2. **Matching depends on delegates opting in.** Only delegates who have explicitly linked an
   address in HighSignal can be scored. At the time of writing this is **1 of 50** delegates on the
   roster, because only 2 of 191 HighSignal users expose an address at all.

The discovery of `historicalScores` is a material improvement: it means this pillar has ~12 months
of real history immediately, rather than only accruing forward from the day we switch it on.

> **Recommendation.** Ratify the methodology now, but **keep this pillar's weight at 0 until
> address coverage is materially better**. Under the missing-data rule below, a live pillar with 2%
> coverage would score 98% of delegates as 0 for a reason that is administrative, not behavioural.
> Raising the weight should be a follow-up vote once coverage is solved — most likely in roster
> generation rather than in the scoring pipeline (see "Who Is Scored").

---

## Pillar 2 — Token Holdings Score (the whale-flattened pillar)

Measures **skin-in-the-game**: how much cSSV + SSV a delegate holds, **and for how long** —
while deliberately **flattening the curve so large holders cannot buy proportional influence.**

`cSSV` (Composable-SSV) is the liquid ERC-20 representation of staked SSV; it is 1:1 with SSV
and retains full governance power. So the two are summed at parity as the holdings base.

The pillar is computed in three stages:

### Stage A — Time-Weighted Average Balance (holdings *over time*)

```
H(t)  = balance_SSV(t) + balance_cSSV(t)          (1:1, both carry governance power)
TWAB  = average of H(t) over a lookback window T   (default T = 180 days)
```

In practice, TWAB is the average of daily balance snapshots across the window.
**Why time-weight:** it rewards *sustained* holders and gives tokens acquired moments before a
vote — or flash-loaned — near-zero weight, because their holding duration in the window is
near-zero. This neutralizes last-minute accumulation and governance-capture-by-loan.

**The window is intersected with the history actually collected.** Averaging over days we never
measured would divide by a period that does not exist: with only 5 days of snapshots and
`T = 180`, a steady 12,000-token holder computes to a TWAB of 333 and scores 18 instead of 100.
Coverage is assessed **across the whole delegate set**, not per delegate, so a delegate with a
shorter history gains no advantage.

The distinction that makes this safe: **a zero must be recorded, not assumed.** The snapshot job
stores a row for every delegate on every collected day, so "held nothing then" is a stored fact —
and recorded zeros still dilute a late purchase exactly as intended.

### Stage B — Concave whale-dampening (square root)

```
raw = TWAB ^ p          with p = 0.5 (square root) as the ratified default
```

A concave transform means influence grows far slower than balance: a holder with **100× the
tokens gets only 10× the raw score.** We recommend the **square root** specifically:

- vs **linear** (`p = 1`) — linear is pure plutocracy; a 100× whale gets 100× the weight.
- vs **logarithmic** — log over-flattens (stake becomes almost meaningless) and, in the
  governance-attack literature, is *strictly worse* than square-root against wallet-splitting.

Square root is the standard, well-understood middle ground (it is the same √n relationship
used by quadratic voting). The exponent `p` is exposed as a governance lever; a logarithmic mode
exists for comparison but is not recommended.

### Stage C — Reference cap → 0–100

```
S_holdings = 100 × min( 1, (TWAB / HOLD_REF) ^ p )
           = 100 × min( 1, √(TWAB / HOLD_REF) )        at the default p = 0.5
```

`HOLD_REF` is a DAO-set reference holding that earns full marks (e.g. 10,000 SSV-equivalent).
The `min(…, 1)` adds an **absolute ceiling** on top of the concave curve — double protection:
concave growth *and* a hard cap, so ultra-whales cannot exceed a normal committed holder.

### Table 2 — How the curve flattens (HOLD_REF = 10,000, p = 0.5)

| Time-weighted holding | vs reference | **S_holdings** |
|---|---|---|
| 100 | 1% | 10 |
| 1,000 | 10% | 31.6 |
| 2,500 | 25% | 50 |
| 10,000 | 100% | 100 |
| 100,000 | 1,000% | 100 (capped) |
| 1,000,000 | 10,000% | 100 (capped) |

> A delegate holding **400× more** tokens (2,500 → 1,000,000) sees their holdings sub-score
> only **double** (50 → 100). And since Holdings is one weighted pillar of three, its effect on
> the final Delegate Score is bounded further. Whales get *a* voice, not *the* voice.

### Why concave dampening is sound *here*

Recent research ("Concave is the New Linear", arXiv 2605.18990) proves that square-root/log
dampening cannot stop plutocracy **on permissionless, pseudonymous voting**, because a whale
can split tokens across many wallets to recover linear power. Its recommended remedy is to use
concave dampening **only as one component of a composite mechanism that also includes an
identity layer.**

That is exactly this design:

- The Holdings score attaches to a **vetted delegate identity** (community handle + known
  address), not to arbitrary wallets — so splitting tokens across wallets does not help a
  single delegate.
- It is **one of three pillars**, alongside identity-bound community and voting signals.

So the well-known weakness of concave functions is neutralized by the delegate-identity model
and multi-pillar composition, making square-root dampening appropriate in our setting.

---

## Pillar 3 — Snapshot Participation (recency-weighted)

Measures whether a delegate **actually votes — and recently.** A delegate who was active long
ago but has since gone quiet should not keep a high score, so each proposal's contribution is
weighted by how recent it is. This builds on the existing Snapshot integration
(`voteParticipationRate` over recent closed proposals; already implemented and configurable).

For each proposal `p` in the window, let `votedₚ ∈ {0, 1}` and give it a recency weight:

```
dₚ      = 0.5 ^ (ageₚ / H)          ageₚ = proposal age in days, H = half-life (default 90d)
S_votes = 100 × Σ(votedₚ × dₚ) / Σ(dₚ)
```

The window is the **N most recent proposals that had already closed** on the evaluation date.
Proposals that closed later are never counted, so a delegate is never penalised for a vote that
was not yet possible.

Recent proposals dominate the denominator, so skipping the latest votes lowers the score even
for a delegate who voted often in the past — while voting on everything still yields ~100. The
computation is DAO-owned and directly auditable from stored inputs. The proposal window and the
half-life `H` are governance levers.

> **Known gap.** A delegate is currently scored on proposals that closed *before they became a
> delegate*. Closing this requires a per-delegate delegation-start date (available from the Gnosis
> delegation API / on-chain delegation events) to clamp the window. See "Open Questions".

---

## Missing Data (new in Revision 2)

Revision 1 said only that *"any pillar whose data source is not configured is feature-flagged off
and excluded from the weighted average."* That covers one case and is silent on a second, and the
two must be handled **differently**:

| Case | Rule | Rationale |
|---|---|---|
| **The source is not configured** — no delegate has data for that pillar | Excluded from the weighted average **for everyone**; score computed from the remaining pillars | Revision 1's graceful degradation. Nobody is advantaged or penalised. |
| **The pillar is live, but one delegate is missing from it** | That delegate scores **0** on the pillar | Otherwise missing data outranks a measured low score |

**Why the second rule matters.** If an absent pillar is dropped from an individual's average, then
with `w = {3,3,10}`:

```
Delegate with no community profile : (3×50 + 10×88) / 13 = 79.2
Delegate measured at community 8   : (3×8 + 3×50 + 10×88) / 16 = 65.9
```

Having no data is worth **13 points** more than being measured and scoring poorly. On the live
roster this placed the only delegate with a community score at **#17 of 50**, behind delegates
sitting at a perfect 100 purely because they had nothing to measure. That is an incentive to avoid
being measured, which is the opposite of what a contribution score should reward.

Imputed zeros must be **displayed as imputed**, never as a measurement, so a delegate can see that
a 0 means "we have no record of you" and act on it.

---

## Worked Example (overall Delegate Score)

Delegate *Alice*, with default weights `Community 3, Holdings 3, Votes 10`
(`Σw = 16`), `HOLD_REF = 10,000`:

| Pillar | Raw | Sub-score (0–100) |
|---|---|---|
| Community (HighSignal) | overall score 82 | **82** |
| Holdings | TWAB 2,500 | `100 × √(2500/10000)` = **50** |
| Snapshot Votes | voted the latest 4 of 5 (missed the oldest), half-life 90d, proposals ~30 days apart | **88** |

```
DelegateScore = (3×82 + 3×50 + 10×88) / 16
              = (246 + 150 + 880) / 16
              = 1276 / 16
              = Round(79.75) = 80
```

> The vote sub-score depends on the *spacing* of the proposals, which Revision 1 did not state.
> Thirty-day spacing is the value consistent with both figures quoted here — 88.05 for the oldest
> skipped, 69.88 for the newest — and is what the reference implementation tests against.

**Recency in action:** the same 4-of-5 participation scores **88** when the *oldest* proposal
was skipped, but only **~70** if the *most recent* was skipped instead — flat counting would
give 80 either way. A delegate who stops voting sees this pillar decay toward 0 over a few
half-lives, even if their historical record was strong.

**Whale contrast:** a delegate identical to Alice but holding a time-weighted **1,000,000**
tokens (400× more) scores 100 on Holdings instead of 50 — raising their overall score by only
`3 × (100−50) / 16 ≈ 9.4 points`. Four hundred times the stake buys under ten points.

---

## Display & Tiers

The overall Delegate Score (0–100) is the leaderboard's primary rank. Each pillar remains
individually visible (and sortable) so voters can see *why* a delegate ranks where they do.
Pillars that were imputed rather than measured are marked as such.

---

## Parameters & Governance Levers

Every constant below is a deliberate lever the DAO can ratify now and adjust later without
re-architecting the system.

| Parameter | Default | Governs |
|---|---|---|
| Pillar weights (Community / Holdings / Votes) | 3 / 3 / 10 | Relative pillar influence |
| Community: normalization | native 0–100 | How the HighSignal score maps to 0–100 |
| Holdings: lookback window `T` | 180 days | How much history counts |
| Holdings: concavity `p` | 0.5 (square root) | Whale-dampening strength (1.0 = linear) |
| Holdings: reference cap `HOLD_REF` | 10,000 SSV-eq | Holding that scores 100 |
| Holdings: cSSV : SSV ratio | 1 : 1 | Parity of staked vs liquid token |
| Snapshot: proposal window `N` | 5 | How many recent votes count |
| Snapshot: recency half-life `H` | 90 days | How fast past votes decay in the participation score |
| **Missing data: per-delegate policy** | **count as 0** | How a delegate absent from a live pillar is scored |

A calibration simulator (`.spec/simulator/SPEC.md`) lets any of these be varied against real
collected data before ratification, and exports the chosen configuration as JSON for the
production implementation to consume.

---

## Operations & Cost

- **Delegate roster:** supplied as an input by an upstream process (see "Who Is Scored"). The
  scoring pipeline reads it and does not modify it.
- **Community Contribution:** periodic pull from the HighSignal API (endpoint and schema now
  confirmed — see Pillar 1). No local forum/Discord scoring pipeline is needed. The
  `historicalScores` series provides ~360 days of backfill on first run.
- **Holdings:** a periodic job snapshots each delegate's on-chain SSV + cSSV balance (reusing
  the existing multicall `balanceOf` pattern in `lib/gnosis/`) into a balance-snapshot table;
  TWAB is the windowed average. Daily snapshots over 180 days are sufficient and cheap. Historical
  reads require an **archive** node.
- **Snapshot participation:** already fetched from Snapshot per existing config; free via GraphQL.
- **Graceful degradation:** see "Missing Data" — pillar-level and delegate-level absence are
  handled differently and deliberately.
- **Auditability:** every pillar's inputs and sub-score are stored, so any Delegate Score can
  be independently recomputed. Stored inputs include how many days the TWAB actually averaged over,
  so a score computed on partial history is self-evidently so.

---

## Open Questions

Deliberately unresolved, and recommended as follow-up work rather than blockers:

1. **Community-score coverage (highest priority).** At 1-of-50, Pillar 1 cannot carry real weight.
   This is primarily a **roster-generation** problem rather than a scoring one: the pipeline can
   only match the identities the roster gives it. Options include a delegate-onboarding step that
   requires linking an address in HighSignal, carrying an explicit community identity in the roster
   contract, or a handle-based fallback matching forum/Discord usernames — which would raise
   coverage to 7-of-50 but risks attributing another person's score on a handle collision.
   **Recommended: fix coverage upstream in roster generation; do not weaken identity matching in
   the scoring pipeline.**
2. **Delegation start date**, to stop scoring delegates on proposals predating their delegacy.
3. **Community normalization mode.** `native` is recommended. `minmax` degenerates badly on sparse
   coverage (with one measured delegate the range is zero) and maps the lowest measured delegate to
   0, making them indistinguishable from a delegate with no record.

---

## What You Are Voting On

By approving this proposal, the DAO agrees to:

1. **Adopt the DAO-owned three-pillar Delegate Score** as the primary delegate ranking.
2. **Ratify the pillar methodology** — the Community Contribution (HighSignal), Token Holdings
   (time-weighted + concave + reference cap), and Snapshot Participation (recency-weighted)
   formulas (Table 1, Pillars 1–3).
3. **Ratify the default weights and reference constants** in "Parameters & Governance Levers."
4. **Ratify the missing-data rules** — pillar-level absence excluded for everyone; delegate-level
   absence scored 0 and displayed as imputed.
5. **Launch Pillar 1 at weight 0**, to be raised by follow-up vote once community-score coverage
   is sufficient.
6. **Accept that the delegate roster is an external input** whose generation is a separate concern,
   on the understanding that changes materially altering *who* appears on the leaderboard come back
   to the DAO (see "Who Is Scored").
7. **Approve ongoing operation** — regular ingestion of each pillar's data and display of the
   resulting scores.
8. **Recognize all weights, windows, and reference caps as governance levers** — any future
   change requires a follow-up DAO vote.

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

**Implementation reference (DAOx repo):** `lib/snapshot/` (participation), `lib/gnosis/`
(on-chain `balanceOf` multicall to reuse for holdings), `.spec/architecture.md` › "Delegation
Score System".

**Reference implementation & calibration tool:** `.spec/simulator/SPEC.md` — §4 is the normative
algorithm, including the missing-data and coverage rules ratified above.
