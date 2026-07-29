# Spec S1-2 · Serendipity Distance-Band

**Author:** Fleming (Discovery Scientist) · **Date:** 2026-07-28
**Status:** DRAFT for SM (Orin) DoD/boundary review. **Uncommitted** until Orin relays homes.
**Sprint item:** S1-2. **Depends on:** S1-0 ontology (F3 Domain-Distance). **Feeds:** S1-1 `g_dist` (the peaked value weight) and S1-3 (value-weighted density). **Guards:** similarity ≠ serendipity.
**Boundary:** grep-clean vs `.boundary-blocklist`.

> **What S1-2 owns:** the *geometry*. It turns F3's three qualitative bands (too-close /
> serendipity-band / too-far) into a **metric, two thresholds, and a smooth peaked curve** — the
> continuous `g_dist` that S1-1's ValueScore multiplies. It also fixes the single threshold pair that
> **both** the soft `g_dist` weight **and** the hard `BridgeShape` claim-check reference, so there's
> one source of truth for the band edges.

---

## 1. The distance metric

**`d` = cosine distance** between two embedding vectors: `d = 1 − cos(u, v)`, on a semantic text
embedding model (model choice deferred to the transient build; requirement: sentence/idea-level
semantic embeddings, cached). Range in practice ≈ `[0, 1]` for such models. Larger `d` = more distant.

Two distances, different jobs — both defined here:

| Distance | Between | Drives |
|----------|---------|--------|
| **Idea-distance** `d_idea` | the two poles of the connection — the *source insight* and the *target application* the discovery links | **`g_dist`** (the ValueScore weight) and **`BridgeShape`** (the bridge-claim check) |
| **Domain-distance** `d_dom` | the embedding **centroids** of the two SKOS domain concepts (§3, S1-0) the discovery anchors | the coarse **anchor** for density (S1-3) and a fallback when idea poles aren't separable |

`d_idea` is the primary signal for the band (it's the specific connection's non-obviousness);
`d_dom` is the coarse domain-level view used for clustering/density. A domain centroid = the mean
embedding of ideas anchored to that concept (or a representative descriptor embedding at cold-start).

**Guard restated:** the objective is **not** minimal distance. Nearest-neighbour (`d → 0`) is the
*cliché* region and scores low. Serendipity is the mid-distance neighbour. The whole of §2 encodes this.

---

## 2. Two thresholds, three bands

Two thresholds `τ_lo < τ_hi` on `d` cut the three bands (F3):

```
0 ───────────── τ_lo ═══════════════ τ_hi ───────────── 1
   too-close      │  serendipity-band  │     too-far
   (cliché /      │  (mid-distance,    │   (noise / no
    restatement)  │   cross-domain)    │    transferable
                  │                    │    mechanism)
```

- `d < τ_lo` → **too-close** (same idea, restated; nearest-neighbour similarity).
- `τ_lo ≤ d ≤ τ_hi` → **serendipity-band** (near enough to be relevant, far enough to be non-obvious).
- `d > τ_hi` → **too-far** (no transferable mechanism; likely spurious).

**These same `τ_lo, τ_hi` are the single source of truth** for (a) the soft `g_dist` curve (§4) and
(b) the hard `BridgeShape` check in S1-0 (a `bridges` *claim* is well-formed iff `d ∈ [τ_lo, τ_hi]`).
One band definition, two consumers — soft value + hard integrity.

---

## 3. Proposed starting thresholds (pre-embedding priors — recalibrate once vectors exist)

No embedding engine exists yet, so these are **honest ballpark priors on the cosine-distance scale**,
labelled for replacement by §5's empirical calibration. For typical semantic text embeddings:
same-domain paraphrases cluster low, genuinely-cross-domain-but-related sit mid, unrelated sit high.

| Parameter | Proposed start | Basis (prior, to be recalibrated) |
|-----------|:---:|-----------|
| `τ_lo` (cliché edge) | **0.30** | Below this, pairs are typically restatements / same-domain paraphrase. |
| `τ_hi` (noise edge) | **0.70** | Above this, pairs are typically unrelated with no shared mechanism. |
| `c` (band center / curve peak) | **0.50** | Midpoint of the band; where serendipity value is maximal. |
| `σ` (curve width) | **0.13** | Chosen so `g_dist` falls to near its tail floors at the band edges (§4). |

**Status: priors, not empirical.** §5 replaces them from labelled data; the S1-1 calibration loop then
tunes `c`/`σ` continuously from realized hits, exactly as it tunes the weights.

---

## 4. The peaked value curve `g_dist(d)` (continuous form of S1-1's piecewise anchors)

S1-1 ratified piecewise anchors (`too-close 0.20 / band 1.00 / too-far 0.15`). S1-2 makes them a
**smooth, peaked, tunable curve** — a Gaussian bump centered at `c`, with **asymmetric tail floors** so
the ratified anchors are reproduced (cliché penalized less than noise) and **no region is ever zero**
(no-exclusion at the geometry level):

```
g_dist(d) = max( floor(d),  exp( −(d − c)² / (2σ²) ) )

where floor(d) = 0.20  if d ≤ c      (near/cliché tail — a known-but-obvious link retains some value)
                 0.15  if d >  c      (far/noise tail — penalized slightly more; higher spurious risk)
```

- **Peak `= 1.0` at `d = c`** (band center) — maximum serendipity value.
- **Smoothly falls** toward each edge, then holds at the asymmetric floor — so a too-close cliché still
  scores `0.20` and a too-far leap still scores `0.15`; **both stay in the ranking, never excluded.**
- **Asymmetry rationale:** too-close is *known-but-real* (a restatement can still be mildly useful);
  too-far is *likely-spurious* (no transferable mechanism), so it floors lower. Matches the ratified
  0.20 > 0.15.
- **`(c, σ)` are the "center/width" the calibration loop tunes.** Widening `σ` = more permissive band;
  shifting `c` = the system's learned notion of "ideal distance." These are learnable the same way the
  weights are (S1-1 §5), with the same guardrails (shrinkage to ratified priors, step caps).

This curve **is** "similarity ≠ serendipity" as continuous geometry: minimal-distance (`d→0`) is pinned
to the low near-floor, not rewarded.

---

## 5. Empirical calibration methodology (how the priors get replaced — the real basis)

The DoD asks the band to be defended against **both** cliché and noise **with empirical basis.** Method,
runnable as soon as the embedding engine exists:

1. **Cliché distribution → sets `τ_lo`.** Assemble a labelled set of known-obvious / restatement pairs
   (same-domain paraphrases; discoveries the team tagged "we already knew this"). Compute their `d`.
   Set **`τ_lo` = ~90th percentile** of this distribution (most clichés fall below it).
2. **Noise distribution → sets `τ_hi`.** Assemble known non-sequiturs (random cross-domain pairings
   with no transferable mechanism, and past discoveries judged spurious). Compute their `d`. Set
   **`τ_hi` = ~10th percentile** of this distribution (most noise falls above it).
3. **Hit validation (the empirical defence).** Once the S1-3 funnel has accumulated hits (S1-1 §3),
   check that **realized hits concentrate inside `[τ_lo, τ_hi]`** and that too-close/too-far regions
   under-produce hits. If hits leak into a tail, the band is mis-set — adjust and re-validate. This
   closes the empirical loop: the band is justified by *where value actually landed*, not by assertion.
4. **Continuous tuning.** Thereafter `c`/`σ` (and `τ_lo`/`τ_hi`) are tuned by the S1-1 calibration loop
   from realized hits, under its guardrails. The band stops being a fixed line and becomes a learned,
   defensible region.

**Anti-collapse guard (charter guardrail):** the tuning must never let the band drift toward `d → 0`
(which would re-institute nearest-neighbour similarity as the objective). The exploration reserve
(S1-1 §5) protects this by keeping effort on higher-distance regions even when recent hits skew closer.

---

## 6. What consumes S1-2

- **S1-1 ValueScore:** `g_dist(d_idea)` (§4) is the peaked weight, `w_dist = 0.28` (ratified).
- **S1-0 `BridgeShape` (hard):** a `bridges` claim is well-formed iff `d_idea ∈ [τ_lo, τ_hi]`; outside
  ⇒ retype the claim (not exclude the discovery). Same `τ` pair as the soft curve.
- **S1-3 density:** `d_dom` centroids give the coarse domain anchor for value-weighted clustering.

## 7. Definition of Done — self-check (S1-2)

- [x] A distance metric defined (cosine `d`), with idea-level vs domain-level distinguished by job.
- [x] Two thresholds + three bands, as **one source of truth** for both the soft weight and the hard
      `BridgeShape` check.
- [x] Band **defends against both edges** — cliché (`too-close`) *and* noise (`too-far`) — via the
      peaked curve + asymmetric floors.
- [x] Continuous `g_dist` curve replacing S1-1's piecewise anchors, tunable by `(c, σ)`, never zero
      (no-exclusion).
- [x] **Empirical basis** specified: percentile calibration off labelled cliché/noise sets + hit
      validation; then continuous tuning by the S1-1 loop.
- [x] Starting thresholds proposed as explicit **pre-embedding priors** to recalibrate.
- [x] Boundary-safe; uncommitted.

## 8. Kaizen candidate

**Hit-validated band as a reusable pattern.** Justifying a similarity threshold by *where realized hits
land* (step 3) rather than by intuition is a transferable method for any team that has to draw a
"relevant but non-obvious" line — the empirical answer to "how close is too close?"
