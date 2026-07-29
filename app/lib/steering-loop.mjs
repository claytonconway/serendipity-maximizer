// steering-loop.mjs — the self-adjusting weight loop (S2-3)
//
// Implements the calibration / active-steering policy specified in
// working-drafts/spec-value-weighting.md §5 (the "tuning loop"), consuming the
// HitOutcome stream defined in spec-funnel-metric.md §3 and tuning the value
// weights plus the distance band (c/σ) from spec-distance-band.md.
//
// Design contract (per spec §5.1): the fit is an ONLINE, REGULARIZED, LINEAR
// re-fit — interpretable on purpose, never a black box. Every weight change is
// legible so the PO can read it, and the acquisition policy is
//   acquisition = exploit(learned weights) + explore(under-sampled surprise)
// so the loop cannot collapse back toward "what won before" = similarity, the
// exact trap the system exists to beat (§5.3 exploration reserve).
//
// Pure, deterministic, offline: no network, no clock reads inside the math
// (callers pass `now`), no dependencies. Ratified starting dials are constants
// and are NOT modified — the loop drifts from them under an L2 anchor.

// ─────────────────────────────────────────────────────────────────────────────
// Ratified dials (PO-ratified per spec-value-weighting §2 / spec-distance-band §3).
// These are the L2 shrinkage anchors (§5.3) and the cold-start hold values.
// Do NOT edit these values — the loop learns *away* from them, bounded.
// ─────────────────────────────────────────────────────────────────────────────

export const RATIFIED_WEIGHTS = Object.freeze({
  dist: 0.28, // w_dist — cross-domain mid-distance: serendipity's geometric core
  surp: 0.25, // w_surp — felt assumption-violation, the named objective
  imp: 0.22,  // w_imp  — guards "delightful but useless"
  gen: 0.13,  // w_gen  — breadth / venture-density signal
  sp: 0.12,   // w_sp   — human gut prior, deliberately lowest (expected to fade)
});

export const RATIFIED_TYPEMULT = Object.freeze({
  A: 0.95, // Anomaly — held HIGH on purpose (penicillin was an Anomaly)
  B: 1.00, // Bridge  — archetypal cross-domain form
  C: 0.92, // Constraint Flip
  D: 0.90, // Scale Shift
});

export const RATIFIED_BAND = Object.freeze({
  c: 0.50,     // band center / peak of g_dist
  sigma: 0.13, // curve width
  tauLo: 0.30, // cliché edge (source of truth shared with BridgeShape)
  tauHi: 0.70, // noise edge
});

// ─────────────────────────────────────────────────────────────────────────────
// Guardrail constants (§5.2 cadence + §5.3 guardrails).
// ─────────────────────────────────────────────────────────────────────────────

export const GUARDRAILS = Object.freeze({
  WEIGHT_FLOOR: 0.03,      // §5.3 per-facet floor — no facet is ever silenced
  TYPEMULT_FLOOR: 0.80,    // §5.3 per-type floor — protects rare types (Type A)
  STEP_CAP: 0.15,          // §5.3 no single weight moves > ~15% per cycle
  COLD_START_K: 15,        // §5.2 hold ratified defaults until ≥15 resolved
  BATCH_MIN_OUTCOMES: 20,  // §5.2 re-fit every ≥20 resolved …
  BATCH_MAX_DAYS: 30,      // §5.2 … or 30 days, whichever first
  LEARNING_RATE: 0.6,      // step size of the regularized gradient
  SHRINKAGE: 0.12,         // λ: L2 pull back to the ratified anchor
  TYPEMULT_LR: 0.10,       // TypeMult nudge rate
  BAND_LR: 0.20,           // band c/σ nudge rate
  BAND_C_MIN: 0.35,        // anti-collapse: c must never drift toward d→0
  BAND_C_MAX: 0.65,
  BAND_SIGMA_MIN: 0.08,
  BAND_SIGMA_MAX: 0.20,
  EXPLORE_BETA: 0.55,      // weight of the exploration bonus in acquisition
  AUTO_APPLY_BOUND: 0.05,  // PO diff-ratify: |Δ| ≤ this auto-applies, else escalate
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WEIGHT_KEYS = ["dist", "surp", "imp", "gen", "sp"];

// Realized-hit value map (spec §3 / funnel §3). `delayed` scores like a `hit`
// (+1.0) and — because the HitOutcome carries the ORIGINAL facetProfileAtCapture
// — it credits the facets that first scored the slow-burn discovery. That is the
// mechanism that stops the loop learning to punish slow burns.
const HIT_VALUE = Object.freeze({
  weak: 0.5, hit: 1.0, strong: 1.5, delayed: 1.0, "not-yet": 0.0,
});
const MAX_HIT = 1.5; // `strong`; used to normalize the fit target into [0,1]

export function hitValue(realizedHit) {
  const key = String(realizedHit).toLowerCase().replace(/[_\s]+/g, "-");
  const v = HIT_VALUE[key];
  if (v === undefined) throw new Error(`unknown realizedHit: ${realizedHit}`);
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Facet → sub-score maps g_f (spec §1.1). Each returns [0,1].
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Continuous idea-distance from a facet profile: prefer d_idea; fall back to a
// representative distance for a qualitative band label.
const BAND_REP_D = { "too-close": 0.15, "serendipity-band": 0.50, "too-far": 0.85 };
export function ideaDistance(profile) {
  if (typeof profile.d_idea === "number") return profile.d_idea;
  const rep = BAND_REP_D[String(profile.distanceBand)];
  return rep === undefined ? RATIFIED_BAND.c : rep;
}

// Peaked, non-monotonic distance value (spec-distance-band §4): a Gaussian bump
// at the band center with asymmetric tail floors — the continuous form of
// "similarity ≠ serendipity". Never zero (no-exclusion at the geometry level).
export function gDist(profile, band = RATIFIED_BAND) {
  const d = ideaDistance(profile);
  const floor = d <= band.c ? 0.20 : 0.15;
  const bump = Math.exp(-((d - band.c) ** 2) / (2 * band.sigma ** 2));
  return Math.max(floor, bump);
}
export const gSurp = (p) => clamp01((Number(p.surprise) - 1) / 4);   // 1..5
export const gImp = (p) => clamp01((Number(p.impact) - 1) / 9);      // 1..10
const GEN_MAP = { point: 0.25, vertical: 0.50, platform: 0.80, universal: 1.00 };
export const gGen = (p) => clamp01(GEN_MAP[String(p.generality)] ?? 0.25);
export const gSp = (p) => clamp01((Number(p.serendipityPotential) - 1) / 9); // 1..10

// Feature vector (the five g_f sub-scores) — the linear model's inputs.
export function featureVector(profile, band = RATIFIED_BAND) {
  return {
    dist: gDist(profile, band),
    surp: gSurp(profile),
    imp: gImp(profile),
    gen: gGen(profile),
    sp: gSp(profile),
  };
}

const typeMultOf = (typeMult, type) =>
  typeMult[type] ?? RATIFIED_TYPEMULT[type] ?? 1.0;

// ValueScore (spec §1): TypeMult · Σ w_f g_f. Stays in [0,1].
export function valueScore(profile, state = defaultState()) {
  const x = featureVector(profile, state.band);
  const bracket = WEIGHT_KEYS.reduce((s, k) => s + state.weights[k] * x[k], 0);
  return typeMultOf(state.typeMult, profile.type) * bracket;
}

// ─────────────────────────────────────────────────────────────────────────────
// State helpers
// ─────────────────────────────────────────────────────────────────────────────

export function defaultState() {
  return {
    weights: { ...RATIFIED_WEIGHTS },
    typeMult: { ...RATIFIED_TYPEMULT },
    band: { ...RATIFIED_BAND },
  };
}

const sum = (obj) => WEIGHT_KEYS.reduce((s, k) => s + obj[k], 0);

// Clamp every weight to the floor, then renormalize the surplus over the weights
// still above the floor so the vector sums to 1 AND every floor holds (§5.3).
function normalizeWithFloors(w, floor = GUARDRAILS.WEIGHT_FLOOR) {
  const out = { ...w };
  for (let iter = 0; iter < 12; iter++) {
    for (const k of WEIGHT_KEYS) out[k] = Math.max(out[k], floor);
    const total = sum(out);
    if (Math.abs(total - 1) < 1e-12) break;
    const free = WEIGHT_KEYS.filter((k) => out[k] > floor + 1e-12);
    const fixedSum = (WEIGHT_KEYS.length - free.length) * floor;
    const freeSum = free.reduce((s, k) => s + out[k], 0);
    const targetFree = 1 - fixedSum;
    if (freeSum <= 0 || targetFree <= 0) {
      const s = 1 / total; // degenerate: even scale
      for (const k of WEIGHT_KEYS) out[k] *= s;
      break;
    }
    const scale = targetFree / freeSum;
    for (const k of free) out[k] *= scale;
  }
  return out;
}

// Rate + step cap (§5.3): no single weight moves > cap·old. Implemented as a
// convex blend toward the old vector — since oldW and newW each sum to 1, so
// does any blend α·new+(1−α)·old, so this caps every move WITHOUT breaking the
// sum-to-1 invariant (a post-cap renormalize would re-break the cap). α is set
// by the worst violator so all moves shrink proportionally.
function capMoves(oldW, newW, cap = GUARDRAILS.STEP_CAP) {
  let alpha = 1;
  for (const k of WEIGHT_KEYS) {
    const move = Math.abs(newW[k] - oldW[k]);
    const limit = cap * oldW[k];
    if (move > limit && move > 1e-12) alpha = Math.min(alpha, limit / move);
  }
  const out = {};
  for (const k of WEIGHT_KEYS) out[k] = oldW[k] * (1 - alpha) + newW[k] * alpha;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The regularized online re-fit (spec §5.1) — PURE.
//   input : batch of HitOutcome, current state
//   output: proposed next state (weights renormalized, floors + caps honored)
// One gradient step on  Σ (ŷ_i − ỹ_i)² + λ‖w − w0‖²  where ŷ = Σ w_f x_f (the
// bracket) and ỹ = realized value normalized to [0,1]. Facets whose sub-score
// co-varies with realized value gain weight; the L2 term anchors to ratified.
// ─────────────────────────────────────────────────────────────────────────────

export function regularizedRefit(outcomes, state = defaultState(), g = GUARDRAILS) {
  const w0 = RATIFIED_WEIGHTS;             // L2 anchor = ratified defaults
  const wCur = state.weights;
  const rows = outcomes.map((o) => ({
    x: featureVector(o.facetProfileAtCapture, state.band),
    y: hitValue(o.realizedHit) / MAX_HIT,  // target in [0,1]
    profile: o.facetProfileAtCapture,
  }));
  const n = rows.length;

  // ── weights: gradient of regularized MSE ──
  let wNext = { ...wCur };
  if (n > 0) {
    const grad = { dist: 0, surp: 0, imp: 0, gen: 0, sp: 0 };
    for (const r of rows) {
      const yhat = WEIGHT_KEYS.reduce((s, k) => s + wCur[k] * r.x[k], 0);
      const resid = yhat - r.y;
      for (const k of WEIGHT_KEYS) grad[k] += (2 / n) * resid * r.x[k];
    }
    for (const k of WEIGHT_KEYS) {
      grad[k] += 2 * g.SHRINKAGE * (wCur[k] - w0[k]); // L2 pull to ratified
      wNext[k] = wCur[k] - g.LEARNING_RATE * grad[k];
    }
  }
  // floors + renormalize (→ sum 1), then convex step-cap (preserves sum 1).
  wNext = normalizeWithFloors(wNext);
  wNext = capMoves(wCur, wNext);

  // ── TypeMult: nudge toward types whose realized value beats the mean ──
  const typeNext = { ...state.typeMult };
  if (n > 0) {
    const overall = rows.reduce((s, r) => s + r.y, 0) / n;
    const byType = new Map();
    for (const r of rows) {
      const t = r.profile.type;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(r.y);
    }
    for (const [t, ys] of byType) {
      const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
      const anchor = RATIFIED_TYPEMULT[t] ?? 1.0;
      const cur = typeMultOf(state.typeMult, t);
      let next = cur + g.TYPEMULT_LR * (mean - overall);      // steer by lift
      next += g.SHRINKAGE * (anchor - cur);                    // shrink to ratified
      const lo = cur * (1 - g.STEP_CAP), hi = cur * (1 + g.STEP_CAP);
      next = Math.min(hi, Math.max(lo, next));                 // step cap
      typeNext[t] = Math.max(g.TYPEMULT_FLOOR, next);          // per-type floor
    }
  }

  // ── band c/σ: pull center toward where realized value actually landed ──
  const bandNext = { ...state.band };
  if (n > 0) {
    let wsum = 0, cAcc = 0;
    for (const r of rows) { const d = ideaDistance(r.profile); cAcc += r.y * d; wsum += r.y; }
    if (wsum > 1e-9) {
      const cTarget = cAcc / wsum;                             // hit-weighted mean d
      let cNext = state.band.c + g.BAND_LR * (cTarget - state.band.c);
      cNext += g.SHRINKAGE * (RATIFIED_BAND.c - state.band.c); // shrink to ratified
      const capLo = state.band.c * (1 - g.STEP_CAP);
      const capHi = state.band.c * (1 + g.STEP_CAP);
      cNext = Math.min(capHi, Math.max(capLo, cNext));         // step cap
      // anti-collapse (spec-distance-band §5): never drift toward d→0.
      bandNext.c = Math.min(g.BAND_C_MAX, Math.max(g.BAND_C_MIN, cNext));
      // σ: track the spread of hit distances, shrink to ratified, clamp.
      let vAcc = 0;
      for (const r of rows) { const d = ideaDistance(r.profile); vAcc += r.y * (d - cTarget) ** 2; }
      const sTarget = Math.sqrt(vAcc / wsum) || state.band.sigma;
      let sNext = state.band.sigma + g.BAND_LR * (sTarget - state.band.sigma);
      sNext += g.SHRINKAGE * (RATIFIED_BAND.sigma - state.band.sigma);
      const sCapLo = state.band.sigma * (1 - g.STEP_CAP);
      const sCapHi = state.band.sigma * (1 + g.STEP_CAP);
      sNext = Math.min(sCapHi, Math.max(sCapLo, sNext));
      bandNext.sigma = Math.min(g.BAND_SIGMA_MAX, Math.max(g.BAND_SIGMA_MIN, sNext));
    }
  }

  return { weights: wNext, typeMult: typeNext, band: bandNext };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exploration reserve (§5.3, critical): acquisition = exploit + explore.
// A count-based (UCB-style) bonus that rewards UNDER-SAMPLED, high-distance /
// high-surprise regions, so effort keeps flowing to expected surprise even when
// recent hits skew close — the loop cannot collapse toward past winners.
// ─────────────────────────────────────────────────────────────────────────────

// Coarse region key over the two serendipity-salient axes (distance × surprise).
export function regionKey(profile) {
  const d = ideaDistance(profile);
  const distBin = d < RATIFIED_BAND.tauLo ? "close" : d > RATIFIED_BAND.tauHi ? "far" : "band";
  const surpBin = Number(profile.surprise) >= 3 ? "hi" : "lo";
  return `${distBin}:${surpBin}`;
}

// Salience toward the directions the system must keep exploring: high idea-
// distance and high surprise. (Not the peaked value curve — exploration should
// pull toward the far frontier that exploitation under-values.)
export function distanceSalience(profile) {
  return 0.5 * clamp01(ideaDistance(profile)) + 0.5 * gSurp(profile);
}

// UCB-style bonus. n = samples already taken in this region, N = total samples.
export function explorationBonus(profile, regionCounts, beta = GUARDRAILS.EXPLORE_BETA) {
  const region = regionKey(profile);
  const n = regionCounts.get(region) ?? 0;
  let N = 0;
  for (const c of regionCounts.values()) N += c;
  const uncertainty = Math.sqrt(Math.log(N + Math.E) / (n + 1));
  return beta * distanceSalience(profile) * uncertainty;
}

// acquisition(profile) = exploit(ValueScore under learned weights) + explore bonus.
export function acquisitionScore(profile, state, regionCounts, opts = {}) {
  const explore = opts.explore !== false;
  const exploit = valueScore(profile, state);
  const bonus = explore && regionCounts ? explorationBonus(profile, regionCounts, opts.beta) : 0;
  return { score: exploit + bonus, exploit, explore: bonus, region: regionKey(profile) };
}

// ─────────────────────────────────────────────────────────────────────────────
// PO diff-ratify hook (§5.3). Emits proposed changes as an old→new diff; changes
// within AUTO_APPLY_BOUND auto-apply, larger shifts are flagged for PO escalation.
// Interface only — no live messaging.
// ─────────────────────────────────────────────────────────────────────────────

export function proposeWeightUpdate(oldState, newState, g = GUARDRAILS) {
  const changes = [];
  const record = (param, oldV, newV) => {
    const delta = newV - oldV;
    changes.push({
      param,
      old: oldV,
      new: newV,
      delta,
      deltaPct: oldV !== 0 ? delta / oldV : null,
      withinAutoBound: Math.abs(delta) <= g.AUTO_APPLY_BOUND,
    });
  };
  for (const k of WEIGHT_KEYS) record(`w_${k}`, oldState.weights[k], newState.weights[k]);
  for (const t of Object.keys(newState.typeMult)) record(`TypeMult_${t}`, oldState.typeMult[t], newState.typeMult[t]);
  record("band_c", oldState.band.c, newState.band.c);
  record("band_sigma", oldState.band.sigma, newState.band.sigma);

  const escalated = changes.filter((c) => !c.withinAutoBound);
  const material = changes.filter((c) => Math.abs(c.delta) > 1e-9);
  return {
    changes,
    autoApplicable: escalated.length === 0,
    escalated,
    summary:
      `${material.length} change(s); ` +
      (escalated.length === 0
        ? "all within auto-apply bound"
        : `${escalated.length} exceed ±${g.AUTO_APPLY_BOUND} — escalate to PO`),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stateful orchestrator — ties ingest → gate → refit → diff → (auto-)apply and
// tracks exploration sample counts. Callers pass `now` (ms); no clock reads here.
// ─────────────────────────────────────────────────────────────────────────────

export function createSteeringLoop(init = {}) {
  const state = init.state ? cloneState(init.state) : defaultState();
  const g = { ...GUARDRAILS, ...(init.guardrails || {}) };
  const regionCounts = new Map();
  let buffer = [];        // outcomes accumulated since the last successful re-fit
  let resolvedCount = 0;  // total resolved outcomes ever seen (cold-start gate)
  let lastFitAt = init.lastFitAt ?? null;

  function ingest(outcome) {
    buffer.push(outcome);
    resolvedCount += 1;
    const key = regionKey(outcome.facetProfileAtCapture);
    regionCounts.set(key, (regionCounts.get(key) ?? 0) + 1);
    return { resolvedCount, pending: buffer.length };
  }

  function shouldRefit(now) {
    if (resolvedCount < g.COLD_START_K) return { ok: false, reason: "cold-start" };
    if (buffer.length === 0) return { ok: false, reason: "no-pending" };
    const batchFull = buffer.length >= g.BATCH_MIN_OUTCOMES;
    const aged = lastFitAt != null && now != null && now - lastFitAt >= g.BATCH_MAX_DAYS * DAY_MS;
    if (batchFull) return { ok: true, reason: "batch-full" };
    if (aged) return { ok: true, reason: "age" };
    return { ok: false, reason: "await-batch" };
  }

  // Attempt a re-fit. `apply` (default true) auto-applies changes within bound
  // and returns the escalation set; larger shifts are held for PO ratification.
  function refit(now, { apply = true } = {}) {
    const gate = shouldRefit(now);
    if (!gate.ok) return { fitted: false, reason: gate.reason, diff: null, state: cloneState(state) };

    const proposed = regularizedRefit(buffer, state, g);
    const diff = proposeWeightUpdate(state, proposed, g);

    let applied = false;
    if (apply) {
      if (diff.autoApplicable) {
        Object.assign(state.weights, proposed.weights);
        Object.assign(state.typeMult, proposed.typeMult);
        Object.assign(state.band, proposed.band);
        applied = true;
      } else {
        // Auto-apply only the within-bound params; hold escalated ones at PO gate.
        const escalatedSet = new Set(diff.escalated.map((c) => c.param));
        for (const k of WEIGHT_KEYS) if (!escalatedSet.has(`w_${k}`)) state.weights[k] = proposed.weights[k];
        state.weights = normalizeWithFloors(state.weights); // keep the invariant
        for (const t of Object.keys(proposed.typeMult)) if (!escalatedSet.has(`TypeMult_${t}`)) state.typeMult[t] = proposed.typeMult[t];
        if (!escalatedSet.has("band_c")) state.band.c = proposed.band.c;
        if (!escalatedSet.has("band_sigma")) state.band.sigma = proposed.band.sigma;
        applied = "partial";
      }
    }

    const batchSize = buffer.length;
    buffer = [];
    lastFitAt = now ?? lastFitAt;
    return { fitted: true, reason: gate.reason, diff, proposed, applied, batchSize, state: cloneState(state) };
  }

  return {
    ingest,
    shouldRefit,
    refit,
    getState: () => cloneState(state),
    getRegionCounts: () => new Map(regionCounts),
    getResolvedCount: () => resolvedCount,
    valueScore: (p) => valueScore(p, state),
    acquisitionScore: (p, opts) => acquisitionScore(p, state, regionCounts, opts),
  };
}

function cloneState(s) {
  return {
    weights: { ...s.weights },
    typeMult: { ...s.typeMult },
    band: { ...s.band },
  };
}
