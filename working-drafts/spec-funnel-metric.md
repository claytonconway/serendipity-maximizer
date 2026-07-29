# Spec S1-3 · Funnel Metric + Domain-Density / Venture-Candidate Output

**Author:** Fleming (Discovery Scientist) · **Date:** 2026-07-28
**Status:** DRAFT — finalized against **PO-ratified** S1-1 dials. For SM (Orin) DoD/boundary review. **Uncommitted** until Orin relays homes.
**Sprint item:** S1-3. **Depends on:** S1-0 (facets, value-weighted density), S1-1 (ratified weights, graded hit, soft floor), S1-2 (distance → `g_dist`, domain centroids). **Closes:** the S1-1 ↔ S1-3 calibration loop.
**Boundary:** grep-clean vs `.boundary-blocklist`.

> **What S1-3 owns:** the *instrumentation*. It turns the lifecycle into a measurable
> `captured → triaged → pursued → shipped` funnel, makes **domain-density** a value-weighted signal
> that flags **venture/partnership candidates** (detection only — PO decides), and **emits the hit
> outcomes that feed S1-1's calibration loop**, closing the learning cycle.

---

## 1. Funnel = the lifecycle, instrumented

Map the four funnel stages onto the board lifecycle
(`New → Reviewing → Team Triage → Decision → Active → Banked`) and onto S1-1's ratified graded hit:

| Funnel stage | Lifecycle event (board `status`) | S1-1 hit grade |
|--------------|----------------------------------|----------------|
| **captured** | enters at `New` | — |
| **triaged** | reaches `Team Triage` (via `Reviewing`) | — |
| **pursued** | reaches `Decision` w/ IMPLEMENT → `Active` | Weak hit (Decision) → **Hit** (Active) |
| **shipped** | terminal outcome: ships **or** feeds a venture-candidate flag (§3) | **Strong hit** |

- **Banked is not a funnel exit — it's a hold.** A `Banked` item carries a reactivation trigger; if it
  later reactivates and reaches `Active` it is a **delayed hit** (S1-1 §3), credited retroactively.
  "Banked ≠ discarded" means the funnel has no leak-to-deletion — only holds and re-entries.
- **`W_hit = 21 days`** (ratified) is the horizon for scoring a captured discovery's realized hit value;
  not reaching `Active` within it is a *learning signal* (0.0), not a discard.

### 1.1 Promotion-rate metric
Per rolling window `W`, per stage transition:

```
promotion_rate(stage_i → stage_i+1, W) = # discoveries advancing / # eligible at stage_i
capture→hit rate(W)                     = # reaching Active (incl. delayed) / # captured
```

Track overall and **sliced by ontology facet** (by Type, by distance-band, by domain) — because a low
capture→hit rate *in a facet slice* is exactly the signal the S1-1 calibration loop consumes to
re-weight. The funnel is not just a scoreboard; it is the loop's sensor.

---

## 2. Value-weighted density (finalized, per S1-0 rev 3 + S1-1)

Density is a **`ValueScore`-weighted sum**, not a floor-gated count (no-exclusion applied to the signal):

```
density(d, W) = Σ  ValueScore(x)     over discoveries x with:
                     d ∈ x.domains            (SKOS concept, agent-level — S1-0 §3)
                     ∧ x.generatedAtTime ∈ W  (PROV-O window — S1-0 §5)
```

- `d` anchored via S1-2's domain **centroids** (`d_dom`); `ValueScore(x)` from S1-1 (ratified weights).
- **Soft floor:** `ValueScore < 0.35` items are Bank-eligible + down-weighted but **still contribute**
  their small `ValueScore`. The soft floor never excludes — it is the *only* mechanism acting on a
  scored discovery. The one thing that is *not* soft-floored is a discovery with **no score yet** — see
  the gate.
- **THE GATE — "Emitted ≠ counted (yet)" (S2-4, replaces the earlier "down-weight ambient until
  triaged" wording).** A `captureMode = ambient-emitter` capture enters at the pre-`New` `emitted`
  state carrying **no bound facets, and therefore no `ValueScore` yet**. Until it is triaged
  (`emitted → New`, which binds its facet profile), it contributes **exactly 0** to (a) this density
  sum and (b) the funnel `captured` denominator. This is **not a fractional down-weight** — it falls
  straight out of the `ValueScore`-weighted sum because a pre-triage item has *no score to add*. The
  `0` means **"not scored yet" (data-availability), never exclusion**: the item is fully alive, listed,
  and promotable, and the instant it is triaged it contributes its `ValueScore` like any other
  discovery. Pre-triage volume is tracked separately as an **emitter-backlog** count (unweighted,
  clearly labeled) that must **not** feed density. Anti-inflation then holds *structurally*: a flood of
  cheap ambient captures adds nothing to a cluster because unscored captures contribute zero — cheap
  volume cannot fake a venture signal. (Ties to the S1-4 emitter spike; consistent with the S1-0 rev-3
  no-exclusion model — 0-because-unscored is a data-availability fact, distinct from the soft floor's
  small-but-nonzero contribution for *scored* low-value items.)
- **Why weighted, not counted:** a cluster of four *strong* discoveries should outweigh twelve weak
  ones. Counting rewards volume; value-weighting rewards concentrated *quality* — which is what a real
  venture signal is.

### 2.1 Proposed DENSITY_THRESHOLD (detection tuning — I propose, tunable)
- **Proposed start: `density(d, W) ≥ 2.5` over `W_density = 90 days`.** Rationale: ~4 solid discoveries
  (`ValueScore ≈ 0.6`) concentrated in one domain within a quarter — enough signal to *look*, not so
  low it fires on noise. Both `2.5` and `90d` are **starting dials**; the calibration loop (or PO) can
  tune them like any other weight.
- **Generality amplifier (recommended):** weight each contribution by its `g_gen` too, so clusters of
  *platform/universal* discoveries flag sooner than clusters of point-fixes — a platform-level cluster
  is a stronger venture signal. Optional; flagged for PO.

### 2.2 Venture / partnership candidate — detection only (hard authority line)
When `density(d, W) ≥ DENSITY_THRESHOLD`, emit a **venture/partnership-candidate escalation** to the PO:

```
{ domain d, density value, contributing discoveries[], window W,
  generality profile, top facet drivers }  → escalate to PO
```

**The engine detects and escalates; the PO (Clayton) makes the go/no-go venture/partnership call.**
This is the systematic version of the observed "one discovery → a venture" path — turned into a
repeatable engine output — with the authority line held per charter, sprint risk log, and S1-1 §6.

---

## 3. Closing the S1-1 ↔ S1-3 calibration loop (the learning cycle)

S1-3 is the **sensor half** of the loop S1-1 §5 specs. For every *resolved* discovery it emits an
outcome record the re-weighter consumes:

```
HitOutcome = {
  discoveryId,
  facetProfileAtCapture: { type, distanceBand/d_idea, surprise, impact, generality, serendipityPotential },
  valueScoreAtCapture,
  realizedHit: weak(+0.5) | hit(+1.0) | strong(+1.5) | delayed(+1.0, retro) | not-yet(0.0),
  resolvedAt, captureMode
}
```

- **Cadence:** emitted as discoveries resolve; the S1-1 loop batches them (≥20 resolved or 30 days,
  cold-start hold <15) — S1-3 just streams the records, it does not re-weight (that's the loop).
- **Delayed-hit re-emission:** when a Banked item reactivates to `Active`, S1-3 re-emits its original
  `facetProfileAtCapture` with `realizedHit: delayed` so the loop credits the *original* scoring
  retroactively — the mechanism that stops the loop learning to punish slow-burns.
- **This is the closed loop:** funnel outcomes (S1-3) → re-weight facets/band (S1-1) → new ValueScores
  → new funnel rankings (S1-3). Clayton's *"time will tell how we adjust these weights"* is now a wired
  cycle, and it is the active-steering policy from the charter (exploit learned weights + the
  exploration reserve that keeps steering toward expected surprise, not past winners).

---

## 4. Computable from the board (stored fields + the named delta)

- **Funnel/promotion:** entirely from `status` transitions (stored) + timestamps.
- **Density:** needs `domains[]` + `ValueScore` (⇒ the S1-0 named delta: `domains[]`, `surprise`,
  `generality`, `captureMode`, `distanceBand`; typed `relations[]`). All additive/nullable — no board
  rewrite; JSON-LD context bridges to RDF (S1-0 §9).
- **HitOutcome emission:** `status` history + `decision` (stored) + `ValueScore` (derived) +
  `reactivationTrigger`/reactivation events (stored). No new storage beyond the S1-0 delta.

---

## 5. Definition of Done — self-check (S1-3)

- [x] Funnel `captured → triaged → pursued → shipped` mapped onto lifecycle + ratified graded hit;
      Banked modeled as a hold, not a leak.
- [x] Promotion-rate metric defined, sliceable by facet (so it can drive re-weighting).
- [x] Density = **ValueScore-weighted sum** (no-exclusion), soft floor, anti-inflation guard.
- [x] **Venture/partnership-candidate flag** on density threshold — **detection + escalation only; PO
      decides** (hard authority line).
- [x] **S1-1 ↔ S1-3 loop closed** — `HitOutcome` emission schema + cadence + delayed-hit re-emission.
- [x] Computable from stored board fields + the S1-0 named delta.
- [x] Proposed `DENSITY_THRESHOLD = 2.5` / `W_density = 90d` as tunable starting dials.
- [x] Boundary-safe; uncommitted.

## 6. For PO (via Orin → Haalee → Clayton)
One new dial to ratify (or defer to the calibration loop): **`DENSITY_THRESHOLD = 2.5` over 90 days**,
plus the optional **generality amplifier** (§2.1). Everything else inherits already-ratified S1-1 dials.
The venture/partnership **decision** remains entirely the PO's; S1-3 only decides *when to raise a hand*.

## 7. Kaizen candidate
**Value-weighted density → venture candidate as a generalized engine output.** The systematic version
of "one discovery became a venture" — worth naming in the project-maximizer squad template as a
repeatable pattern: *concentration of high-value surprise in a domain is itself a discovery.* (Sprint 1
Kaizen Candidate C.)
