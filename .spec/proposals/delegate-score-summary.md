# Delegate Score — in short

Every SSV delegate gets **one number from 0 to 100**. It is the weighted average of three
things we can measure and you can verify.

| Pillar | What it asks | Where it comes from |
|---|---|---|
| **Community** | Do they help the community think? | HighSignal score (Discord + Forum) |
| **Holdings** | Do they have skin in the game? | SSV + cSSV held **over time**, on-chain |
| **Votes** | Do they actually show up? | Snapshot votes, **recent ones count more** |

Three details worth knowing:

- **Holdings are flattened.** 100× the tokens earns only 10× the score, and it is capped. Whales
  get *a* voice, not *the* voice.
- **Old votes fade.** A vote's weight halves every 90 days, so a delegate who has gone quiet
  cannot coast on last year's record.
- **Missing data never helps.** If we can measure a pillar for others but not for you, you score
  0 there — shown as `n/a`, so it is clear it means "no record", not "measured badly".

## The dials

All eight are governance levers: the DAO sets them and can change them by vote.

| Dial | Default | What it does |
|---|---|---|
| Community weight | **3** | How much community contribution counts |
| Holdings weight | **3** | How much stake counts |
| Votes weight | **10** | How much voting counts — the heaviest, on purpose |
| `HOLD_REF` | **10,000** | The holding that earns a perfect 100 |
| `p` | **0.5** | Whale flattening (square root; 1.0 would be pure plutocracy) |
| `T` | **90 days** | How much balance history is averaged |
| `H` | **90 days** | How long a vote takes to lose half its weight |
| `N` | **10** | How many recent proposals count |

At these defaults the overall score is:

![Score at the default weights](delegate-score-defaults.svg)

```latex
\[
\text{Score}=\frac{3\times\text{Community}\;+\;3\times\text{Holdings}\;+\;10\times\text{Votes}}{16}
\]
```

Full detail: [`delegation-score-proposal.md`](delegation-score-proposal.md) ·
Algorithm: [`../simulator/SPEC.md`](../simulator/SPEC.md)

---

## The whole thing, mathematically

![Delegate Score formula](delegate-score-formula.svg)

<!-- Rendered from delegate-score-formula.tex:
     latex delegate-score-formula.tex && dvisvgm --no-fonts --exact-bbox delegate-score-formula.dvi
     PNG (for forums that reject SVG): pdflatex … && gs -sDEVICE=png16m -r400
     A PNG copy sits alongside as delegate-score-formula.png -->

Source, to paste into the proposal:

```latex
\[
\text{Score}=\frac{\sum_{i} w_i S_i}{\sum_{i} w_i}
\qquad\text{where}\qquad
\begin{aligned}
S_{\text{com}} &= c \in [0,100]\\[2pt]
S_{\text{hold}} &= 100\,\min\!\Bigl(1,\bigl(\tfrac{\bar{b}}{R}\bigr)^{p}\Bigr),
   \quad \bar{b}=\tfrac{1}{T}\!\sum_{t=1}^{T} b_t\\[2pt]
S_{\text{vote}} &= 100\,\frac{\sum_{j=1}^{N} v_j\,2^{-a_j/H}}{\sum_{j=1}^{N} 2^{-a_j/H}}
\end{aligned}
\]
```

| Symbol | Meaning |
|---|---|
| $w_i$ | weight of pillar $i$ — 3, 3, 10 |
| $c$ | HighSignal score, already 0–100 |
| $b_t$ | SSV + cSSV held on day $t$; $\bar{b}$ is the average over $T$ days (the TWAB) |
| $R,\;p$ | reference holding 10,000 and concavity 0.5 |
| $v_j$ | 1 if they voted on proposal $j$, else 0 |
| $a_j$ | age of proposal $j$ in days; $H$ is the half-life |

Pillars with no data drop out of both sums. Every $S_i$ is 0–100, so the score is too.

---

## Where the score sends power — and the ceiling on it

The score routes a delegated pool across five cohorts. That pool is **not a number the DAO picks**:
it is whatever token holders auto-delegate, and it only grows. So the program carries a **cap**.

- **Cap `C` = 750,000 SSV-eq.** Anything delegated above it is **voided** — never assigned, never
  voted, not held in reserve.
- **It costs nothing today.** The cap is 3.75× the 200,000 pool already ratified, so it voids
  nothing on adoption and binds only once the program has nearly quadrupled. Then growth stops.
- **What it buys:** the program has a terminal size. A pool that only grows otherwise has no
  stopping point at all.
- **What it does not buy:** at full size the program is ~2.5× the current Snapshot quorum
  (303,829 SSV), 64% of the median turnout of the last twelve contested proposals (426,878 SSV),
  and more than the combined holdings of all 486 delegates (555,251 SSV). It could establish quorum
  alone, and carry a vote *if every funded delegate voted identically* — which the allocation rules
  are designed to make unlikely, but do not prevent. Capping below quorum would mean capping at
  roughly today's pool size; the DAO's analysis chose room to grow instead.

At the ratified cap that is:

![The cap at its ratified value](delegation-cap-defaults.svg)

```latex
\[
D_{\text{eff}}=\min\bigl(D,\;750{,}000\bigr)
\qquad
\text{voided}=\max\bigl(0,\;D-750{,}000\bigr)
\]
```

And in full, with the cohort split:

![Delegation allocation under the cap](delegation-allocation.svg)

```latex
\[
\begin{aligned}
D_{\text{eff}} &= \min\!\left(D,\;C\right), \qquad
\text{voided} \;=\; \max\!\left(0,\;D-C\right)\\[6pt]
B_k &= s_k\,D_{\text{eff}},
\qquad
\pi_k \;=\;
\begin{cases}
\dfrac{B_k}{\lvert M_k\rvert}, & \lvert M_k\rvert>0\\[10pt]
0, & \text{otherwise}
\end{cases}\\[6pt]
\text{unallocated} &= D_{\text{eff}}-\!\!\sum_{k:\,\lvert M_k\rvert>0}\!\! B_k,
\qquad \textstyle\sum_k s_k = 1
\end{aligned}
\]
```

| Symbol | Meaning |
|---|---|
| $D$ | the pool delegated to the program; $C$ the cap |
| $s_k$ | cohort $k$'s share — 45 / 25 / 10 / 15 / 5 % |
| $M_k$ | the delegates in cohort $k$; $\pi_k$ the power each of them draws |

The cap applies to the pool **before** the split, so it never changes the cohort balance or who is
in which cohort — every member's power simply scales down together.
