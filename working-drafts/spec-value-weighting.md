# Spec S1-1 · Value Weighting Function (PROPOSED defaults for PO ratification)

**Author:** Fleming (Discovery Scientist) · **Date:** 2026-07-28
**Status:** DRAFT — **proposed defaults, not final.** Fleming proposes; **PO (Clayton) ratifies.**
**Sprint item:** S1-1 (reframed by PO from "define a value region" → "propose a weighting function").
**Depends on:** S1-0 ontology (facets F1–F9). **Couples to:** S1-3 (funnel emits the hit outcomes that tune these weights). **Uncommitted** until Orin relays artifact homes.
**Boundary:** grep-clean vs `.boundary-blocklist`.

> **PO reframe (verbatim intent):** *"I don't think we should exclude anything. This isn't a filter,
> more of a weighting system, and only a starting point — time will tell how we adjust these weights."*
> Everything below honours **no-exclusion**: low value ⇒ ranks lower / **Bank-eligible**, never dropped.
> **"Banked ≠ discarded"** (a banked discovery carries a reactivation trigger) *is already* the
> no-exclusion principle living in the lifecycle — low weight routes there, not to deletion.

---

## 1. The function: a graded value score, not a boolean region

Every discovery gets a continuous **ValueScore ∈ [0,1]** — a weighted blend of ontology facets — and a
**RankScore** that folds in effort. Nothing is ever excluded; the score only orders and routes.

```
ValueScore(d) = TypeMult(F1) · [ w_dist·g_dist(F3) + w_surp·g_surp(F4)
                                + w_imp·g_imp(F5)  + w_gen·g_gen(F6)
                                + w_sp·g_sp(F9) ]

RankScore(d)  = ValueScore(d) ÷ Effort_weight        # Effort: Low=1, Med=2, High=4
```

- The five continuous weights `w_*` **sum to 1**; `TypeMult` modulates by discovery type. So `ValueScore`
  stays in `[0,1]` and every weight is directly interpretable — essential for PO trust and for the
  calibration loop (§5) to nudge them legibly.
- `RankScore` preserves the board's existing `(Impact × Serendipity_Potential) ÷ Effort_weight`
  intuition (`SKILL.md` §Step 3) but on the graded, multi-facet value instead of two factors.
- Every discovery keeps a score. **A low score is a routing signal (rank low, Bank-eligible), not a
  filter.**

### 1.1 Facet → sub-score maps (`g_f`), each normalized to [0,1]

| Facet | Map `g_f` | Shape | Rationale |
|-------|-----------|-------|-----------|
| **F3 Domain-Distance** | `too-close→0.20`, `serendipity-band→1.00`, `too-far→0.15` (→ smooth **peaked** curve once S1-2 gives continuous distance) | **Non-monotonic — peaked at the band** | This is *similarity ≠ serendipity as a weight*: nearest-neighbour (too-close) and noise (too-far) are both down-weighted; the mid-distance neighbour scores highest. **The single most serendipity-specific term.** |
| **F4 Surprise** | `(surprise − 1) / 4` | monotonic ↑ | Felt assumption-violation — the system's namesake. |
| **F5 Impact** | `(impact − 1) / 9` | monotonic ↑ | Surprise must also *matter*. |
| **F6 Generality** | `point 0.25 / vertical 0.50 / platform 0.80 / universal 1.00` | ordinal ↑ | Breadth of applicability; also feeds venture-density signal (high generality + density = strong venture candidate). |
| **F9 Serendipity-Potential** | `(sp − 1) / 9` | monotonic ↑ | The **human/agent prior** on serendipity. Deliberately low-weighted (§2) and expected to *decay* as the computed geometry proves itself — a natural calibration target, not a permanent input. |

`TypeMult(F1)`: `A 0.95 · B 1.00 · C 0.92 · D 0.90` — deliberately **near-flat** (§2).

---

## 2. Proposed initial DEFAULT weights + per-weight reasoning

**All values below are tunable STARTING defaults for Clayton to ratify — not final.** Reasoning is
given per weight so the ratification is informed.

| Weight | Proposed default | Reasoning |
|--------|:---:|-----------|
| `w_dist` (Domain-Distance) | **0.28** | Highest. Cross-domain mid-distance *is* serendipity's geometric core, and the peaked map is our structural guard against the system optimizing toward cliché. If any facet should lead, it's this one. |
| `w_surp` (Surprise) | **0.25** | Second. The named objective is *surprise*. Kept just under distance because a felt surprise that is geometrically trivial (someone simply hadn't seen an in-domain fact) is worth less than a genuine cross-domain jump. |
| `w_imp` (Impact) | **0.22** | Guards against "delightful but useless." A surprising, distant connection with no impact should rank below a slightly-less-surprising one that moves the venture. |
| `w_gen` (Generality) | **0.13** | Rewards discoveries that generalize (platform/universal), which also become the venture/partnership candidates when they cluster (S1-3). Mid-low so it informs but doesn't dominate. |
| `w_sp` (Serendipity-Potential) | **0.12** | Lowest **on purpose.** F9 is the human gut prior; our whole project is to *replace gut with instrument*. Low weight lets the computed geometry lead while retaining human signal for the calibration loop to learn from (and likely fade). |
| `TypeMult` A/B/C/D | **0.95 / 1.00 / 0.92 / 0.90** | **Near-flat by design — do NOT prejudge types.** B (Bridge) is the archetypal cross-domain form, nudged to 1.0; but **A (Anomaly) is held high (0.95) precisely because the canonical serendipity — penicillin — was an Anomaly.** The small spread is a faint prior only; §5's loop widens or flattens it from real hit rates, and the existing calibration diversity guard (`SKILL.md`: "any type missing 3+ sessions → mandate it") keeps any type from being starved. |

**Design stance:** weights lead with the two facets that make a surprise *serendipitous* (distance +
surprise = 0.53 together), balanced by impact so value isn't just novelty, with type kept near-flat so
the system learns type value rather than assuming it.

---

## 3. Proposed "hit" definition (graded, no-exclusion-safe)

A **hit** = captured serendipity that paid off. Mapped onto the lifecycle
(`New → Reviewing → Team Triage → Decision → Active → Banked`), graded to match the graded philosophy:

| Outcome | Trigger | Learning signal |
|---------|---------|-----------------|
| **Weak hit** | Reaches `Decision` with an IMPLEMENT decision | +0.5 |
| **Hit** | Reaches `Active` (team is working it) | +1.0 |
| **Strong hit** | Produces a terminal outcome — ships, **or** contributes to a venture/partnership-candidate density flag (S1-3) | +1.5 |
| **Delayed hit** | Was `Banked`, later **reactivates** and reaches `Active` | +1.0, **credited retroactively** to the original facet profile |
| **Not-yet (learning signal, NOT a discard)** | Doesn't reach `Active` within `W_hit` | 0.0 for now; item **stays**, is Bank-eligible with a reactivation trigger |

- **Proposed `W_hit` = 21 days**, reusing the board's existing calibration horizon (`SKILL.md`:
  "Time to action >21 days → likely wrong horizon — bank and redirect"). Tunable.
- **The delayed-hit rule is the "Banked ≠ discarded" principle made into a learning signal:** a banked
  item that later pays off retroactively rewards the facets that scored it, so the loop *cannot* learn
  to hate slow-burn discoveries. This is the single most important coupling to no-exclusion.

---

## 4. Proposed SOFT floor (Bank-eligible, never a cutoff)

Per Orin's guidance, the S1-3 priority FLOOR becomes a **soft floor**:

- **Proposed soft floor: `ValueScore < 0.35`.** Roughly the bottom third; fully tunable.
- **Effect:** below the floor a discovery is **Bank-eligible** — auto-suggested for Banking *with a
  reactivation trigger* — and down-weighted in `RankScore`. It is **never deleted, never barred from
  re-entry**, and a later reactivation makes it a delayed hit (§3).
- **In density (S1-3):** the floor is *not* a hard include/exclude on the count. Instead density becomes
  **value-weighted** — each discovery contributes its `ValueScore` (see §6, S1-0 flag D). Low-value
  items contribute little but are never zeroed out. This is no-exclusion applied to the density signal.

---

## 5. Calibration tuning hook — the self-adjusting weight loop (SPEC ONLY; build is a later transient)

This is Clayton's *"time will tell how we adjust these weights"* made concrete: an **automated
re-weighting loop** that learns the weights from realized hit outcomes off the S1-3 funnel. It is also
the **active-steering / acquisition policy** from my charter — the generalization of the calibration
engine's focus-directives (`SKILL.md` §Step 6) from a static threshold table into a learning objective.
**Spec only — implementation is a later transient spawn the SM commissions.**

### 5.1 Signal → target → mechanism
- **Signal in:** for each *resolved* discovery, the S1-3 funnel emits `(facet profile at capture,
  realized hit value from §3)`.
- **Target:** the weights `w_*`, `TypeMult`, and the distance peak's center/width that best predict
  realized value.
- **Mechanism:** an **online, regularized linear fit** — after each batch, nudge each weight toward
  facets that correlated with realized hits, then renormalize the `w_*` to sum to 1. **Kept linear and
  interpretable on purpose** (not a black box) so the PO can read every weight change and so the system
  stays legibly "a weighting we adjust," per the reframe.

### 5.2 Update cadence
- **Batched, never per-event:** re-fit every **≥20 resolved outcomes or 30 days**, whichever first.
  Per-event updates overfit to noise. Cold-start: **hold the ratified defaults until ≥ K=15 resolved
  outcomes** exist.

### 5.3 Guardrails (against runaway / overfitting) — *this is where the loop earns trust*
| Guardrail | Rule |
|-----------|------|
| **Shrinkage to ratified defaults** | An L2 prior anchors weights on Clayton's ratified values; they may drift but are pulled back. Prevents runaway. |
| **Per-facet weight floor** | No weight → 0. Every facet keeps a minimum voice (`w_f ≥ 0.03`; `TypeMult ≥ 0.80`). **No-exclusion at the weight level too** — protects Type A / rare types (penicillin lesson). Reinforces the existing "any type missing → mandate it" guard. |
| **Rate + step caps** | Small learning rate; no single weight moves > ~15% per cycle. |
| **Min-sample gate** | No update below the cold-start threshold (§5.2). |
| **PO diff-ratify** | Proposed weight changes surface to the PO as a **diff to ratify/veto**; auto-apply only within a small bound, escalate larger shifts. Mirrors S1-1's propose→ratify pattern until trust is established. |
| **Exploration reserve (critical)** | The loop must **not** collapse to exploitation. A pure hit-maximizer drifts toward "what won before" = back toward similarity — re-introducing the exact trap the system exists to beat. So the acquisition policy = **exploit (learned weights) + explore (a bonus for under-sampled high-distance / high-surprise regions).** Classic active-learning / bandit split; it keeps steering toward *expected surprise*, not past winners. Respects the existing novelty-decay guard (`>70% similarity → force Type C/D`). |

### 5.4 Why this is the charter's steering loop
Exploit-from-hits + explore-under-sampled-regions **is** "pick the next exposure to maximize expected
surprise." S1-1's weights are the exploit half; the exploration reserve is the steering half. They are
one mechanism — consistent with the merge-don't-split charter constraint.

---

## 6. Reconciling HARD checks with no-exclusion — the line (my call, documented)

**The line:** *a **data-integrity / well-formedness** check may stay HARD; a **value judgment** must
become a SOFT weight.* Rejecting malformed data does **not** exclude a discovery — it rejects a
malformed *assertion about* the discovery. The discovery stays and is weighted.

### 6.1 The crux — V-E1 / `BridgeShape` (bridges requires serendipity-band)
Two different claims were tangled in rev-2's V-E1; the reframe forces splitting them:

- **"This discovery is low-value"** (its distance is too-close or too-far) → a **VALUE judgment** →
  handled **softly** by the peaked `g_dist` weight (§1.1). Too-close/too-far are down-weighted, **never
  excluded.** A cliché-adjacent discovery still gets a score and can still Bank/reactivate.
- **"This *bridge claim* is malformed"** (an edge is *typed* `bridges` but its endpoints aren't
  mid-distance) → a **data-integrity judgment** → stays **HARD.** Rejecting the edge means *"this isn't
  a bridge"* — a **reclassification of the claim**, not a deletion of the discovery. The discovery
  remains, re-typed (e.g. it was an Anomaly, not a Bridge), and is weighted normally.

**So `BridgeShape` severity does NOT change — it stays `sh:Violation` — but its *scope* narrows to the
bridge assertion, and its message/ remedy change to "retype, don't exclude."** similarity ≠ serendipity
is now enforced in **two complementary layers**: **soft** (the `g_dist` value weight) and **hard** (the
`BridgeShape` claim-integrity check). Cleaner and more correct than one blurred rule.

### 6.2 Full reconciliation table (which S1-0 checks land where)

| S1-0 check | Kind | Verdict | Note |
|------------|------|---------|------|
| V-N1 one type · V-N2 ≥1 domain · V-N4 ranges · V-N5/6/8 enums · V-N7 legal transition | integrity | **HARD** | Malformed/out-of-range data. Repair, don't exclude. |
| V-N3 Type B ⇒ ≥2 domains | integrity | **HARD** | A bridge connects ≥2 by definition; <2 ⇒ **re-type**, not drop. |
| V-E2 converges symmetric + cross-domain · V-E3 Convergence ≥3/≥3 · V-E4 refines same-domain · V-E5 acyclic · V-E6 no self/dup | integrity | **HARD** | Structural well-formedness of edges/derived nodes. |
| **V-E1 `BridgeShape`** | integrity **of the bridge claim** | **HARD (rescoped)** | Rejects a mis-typed *bridge edge*; the **discovery stays + gets weighted.** See §6.1. |
| **Distance → value (the peaked `g_dist`)** | value | **SOFT weight** | Where too-close/too-far are penalized *in value*, never excluded. |
| Priority FLOOR | value | **SOFT floor** | Bank-eligible + down-weight (§4). |
| V-N9 epistemic marker · V-E7 superseded-but-Active | advisory | **SOFT (warn)** | Already warnings; unchanged. |

**One-line rule for future checks:** *if a check answers "is this data well-formed?" it can be hard; if
it answers "is this discovery good?" it must be a soft weight.*

---

## 7. S1-0 revisions the reframe forces (flagged for Orin — NOT yet applied)

Holding these as flags (not edits) so I don't churn S1-0 rev-2 while it's under your DoD/boundary
review. On your go I'll apply them:

- **Flag A — `BridgeShape` (V-E1) rescope, not re-severity.** Keep `sh:Violation`, but reword intent +
  message to "validates a `bridges` *claim* (mid-band); on violation, **retype** the edge/discovery —
  does **not** exclude the discovery." Add a cross-ref that distance→value is the soft `g_dist` weight.
- **Flag B — split the similarity≠serendipity story** in S1-0 §2.1/§7/§8 into the two complementary
  layers (soft `g_dist` weight + hard claim-integrity), replacing the single "structural home" framing.
- **Flag C — priority FLOOR → soft floor** wherever S1-0 references it (§6 density note): Bank-eligible
  + down-weight, not a cutoff.
- **Flag D — density becomes value-weighted.** In S1-0 §6, change `density(d,W)` from a hard
  `priority ≥ FLOOR` **count** to a **`ValueScore`-weighted sum** over domain/window. Low-value items
  contribute fractionally, never zero — no-exclusion applied to the density signal. (Also an S1-3
  inheritance.)
- **Flag E — add derived measures.** Register `ValueScore` and `RankScore` in S1-0 as derived facets
  referencing F1/F3/F4/F5/F6/F9, pointing to this spec as their definition.

None of these change the ontology's *facets or relationships* — they refine severity scope, the density
aggregation, and add two derived measures. Low-risk, coherence-improving.

---

## 8. What downstream now inherits (weighting, not a filter)

- **S1-2 (distance band):** band position becomes a **weight input** to `g_dist` (the peaked curve),
  **not a gate.** S1-2 sets the continuous curve's center/width; `BridgeShape` still hard-checks bridge
  *claims*.
- **S1-3 (funnel + density):** finalizes **only after Clayton ratifies these defaults.** Inherits the
  graded hit (§3), the soft floor (§4), value-weighted density (§7 Flag D), and — crucially — **emits
  the hit outcomes that feed the §5 calibration loop.** S1-1 ↔ S1-3 are now a closed learning loop.

---

## 9. Definition of Done — self-check (S1-1, reframed)

- [x] Weighting function (not a boolean region): graded `ValueScore` over all facets; **nothing dropped**.
- [x] **All four types weighted (A included, held high — penicillin);** none excluded.
- [x] Proposed initial **default weights + per-weight reasoning**, explicitly tunable starting points.
- [x] Proposed **"hit" definition** (graded + delayed-hit for reactivation).
- [x] Proposed **SOFT floor** (Bank-eligible, never a cutoff); ties to "Banked ≠ discarded".
- [x] **Calibration tuning hook spec** — signal/target/mechanism, cadence, and guardrails incl. an
      **exploration reserve** so the loop doesn't collapse back toward similarity. Build deferred.
- [x] **Hard/soft line drawn explicitly** (§6): data-integrity may stay hard; value judgments become
      soft weights; `BridgeShape` rescoped (severity unchanged) with reasoning.
- [x] S1-0 revisions **flagged** (§7), not silently applied.
- [x] Boundary-safe; uncommitted.

## 10. For PO ratification (routes via Orin → Haalee → Clayton)

Clayton is ratifying **informed starting defaults**, not final law:
1. The **weight vector** (§2) — lead with distance+surprise, type near-flat, F9 low.
2. The **hit definition + `W_hit` = 21 days** (§3).
3. The **soft floor `ValueScore < 0.35`** (§4).
4. The **calibration loop existing at all** + its guardrails, especially **PO diff-ratify** and the
   **exploration reserve** (§5).

Every one is a dial the loop (or the PO) can turn later. Ratifying them starts the engine; it doesn't
freeze it.
