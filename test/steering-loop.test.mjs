// Unit tests for the S2-3 steering loop. Plain node:test, zero deps, deterministic.
// Run: node --test test/steering-loop.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  RATIFIED_WEIGHTS, RATIFIED_BAND, GUARDRAILS,
  valueScore, gDist, hitValue, featureVector,
  regularizedRefit, proposeWeightUpdate,
  explorationBonus, acquisitionScore, regionKey,
  createSteeringLoop, defaultState,
} from "../app/lib/steering-loop.mjs";

const DAY = 24 * 60 * 60 * 1000;
const WK = ["dist", "surp", "imp", "gen", "sp"];
const wsum = (w) => WK.reduce((s, k) => s + w[k], 0);

// Synthetic HitOutcome factory (schema per spec-funnel-metric §3).
function outcome(id, p = {}) {
  const {
    type = "B", d_idea = 0.5, distanceBand, surprise = 3, impact = 5,
    generality = "vertical", sp = 5, realizedHit = "hit",
    captureMode = "manual", resolvedAt = 0,
  } = p;
  return {
    discoveryId: `d${id}`,
    facetProfileAtCapture: { type, d_idea, distanceBand, surprise, impact, generality, serendipityPotential: sp },
    valueScoreAtCapture: 0,
    realizedHit,
    resolvedAt,
    captureMode,
  };
}

// ── sanity: dials + maps match the ratified spec ────────────────────────────
test("ratified weights sum to 1 and match spec §2", () => {
  assert.ok(Math.abs(wsum(RATIFIED_WEIGHTS) - 1) < 1e-12);
  assert.equal(RATIFIED_WEIGHTS.dist, 0.28);
  assert.equal(RATIFIED_WEIGHTS.surp, 0.25);
});

test("g_dist is peaked at band center and floored (never zero)", () => {
  const atPeak = gDist({ d_idea: RATIFIED_BAND.c });
  const tooClose = gDist({ d_idea: 0.0 });
  const tooFar = gDist({ d_idea: 1.0 });
  assert.ok(atPeak > 0.99, "peak ≈ 1 at center");
  assert.equal(tooClose, 0.20, "near tail floor");
  assert.equal(tooFar, 0.15, "far tail floor (lower — asymmetric)");
  assert.ok(atPeak > tooClose && tooClose > tooFar, "non-monotonic peak");
});

test("valueScore stays in [0,1] under ratified defaults", () => {
  const best = valueScore({ type: "B", d_idea: 0.5, surprise: 5, impact: 10, generality: "universal", serendipityPotential: 10 });
  const worst = valueScore({ type: "D", d_idea: 1.0, surprise: 1, impact: 1, generality: "point", serendipityPotential: 1 });
  assert.ok(best <= 1 && best > 0.9);
  assert.ok(worst >= 0 && worst < 0.2);
});

test("hitValue map: delayed scores like a hit (+1.0)", () => {
  assert.equal(hitValue("strong"), 1.5);
  assert.equal(hitValue("hit"), 1.0);
  assert.equal(hitValue("delayed"), 1.0);
  assert.equal(hitValue("weak"), 0.5);
  assert.equal(hitValue("not-yet"), 0.0);
});

// ── PROOF 1: weights move toward hit-correlated facets, stay normalized/capped
test("re-fit moves weight toward the hit-correlated facet, renormalized within floors/caps", () => {
  // Surprise is the sole discriminator: strong hits are high-surprise, misses low.
  const stream = [];
  for (let i = 0; i < 10; i++) {
    stream.push(outcome(`s${i}`, { d_idea: 0.37, surprise: 5, impact: 5, generality: "vertical", sp: 5, realizedHit: "strong" }));
    stream.push(outcome(`n${i}`, { d_idea: 0.37, surprise: 1, impact: 5, generality: "vertical", sp: 5, realizedHit: "not-yet" }));
  }
  const next = regularizedRefit(stream, defaultState());

  assert.ok(next.weights.surp > RATIFIED_WEIGHTS.surp, "surp gained (it correlated with hits)");
  // normalization invariant
  assert.ok(Math.abs(wsum(next.weights) - 1) < 1e-9, "weights renormalized to 1");
  // per-facet floor
  for (const k of WK) assert.ok(next.weights[k] >= GUARDRAILS.WEIGHT_FLOOR - 1e-12, `${k} ≥ floor`);
  // step cap: convex-blend cap holds each move to ≤15% exactly (no renorm slack)
  for (const k of WK) {
    const move = Math.abs(next.weights[k] - RATIFIED_WEIGHTS[k]);
    assert.ok(move <= GUARDRAILS.STEP_CAP * RATIFIED_WEIGHTS[k] + 1e-9, `${k} within step cap`);
  }
});

// ── PROOF 2: cold-start holds below K, then fits ────────────────────────────
test("cold-start: no fit below K=15 resolved, fits once batch fills", () => {
  const loop = createSteeringLoop({ lastFitAt: 0 });
  for (let i = 0; i < 14; i++) loop.ingest(outcome(i, { realizedHit: "hit" }));
  let r = loop.refit(DAY);
  assert.equal(r.fitted, false);
  assert.equal(r.reason, "cold-start");
  // unchanged while held
  assert.deepEqual(loop.getState().weights, { ...RATIFIED_WEIGHTS });

  for (let i = 14; i < 20; i++) loop.ingest(outcome(i, { realizedHit: "hit" }));
  r = loop.refit(DAY);
  assert.equal(r.fitted, true, "fits once ≥K resolved and batch (≥20) full");
  assert.equal(r.reason, "batch-full");
});

test("cadence: below batch size and un-aged holds with 'await-batch'", () => {
  const loop = createSteeringLoop({ lastFitAt: 0 });
  for (let i = 0; i < 16; i++) loop.ingest(outcome(i, { realizedHit: "hit" })); // ≥K but <20
  const g = loop.shouldRefit(5 * DAY); // not yet 30 days old
  assert.equal(g.ok, false);
  assert.equal(g.reason, "await-batch");
  // but ages in after 30 days
  assert.equal(loop.shouldRefit(31 * DAY).ok, true);
});

// ── PROOF 3: delayed-hit credits the ORIGINAL facet profile ─────────────────
test("delayed hit credits the original profile (slow-burns are rewarded, not punished)", () => {
  // Same high-surprise profiles; only the realized outcome differs.
  const mk = (hit) => Array.from({ length: 20 }, (_, i) =>
    outcome(i, { d_idea: 0.37, surprise: 5, impact: 5, generality: "vertical", sp: 5, realizedHit: hit }));

  const delayed = regularizedRefit(mk("delayed"), defaultState()); // banked→reactivated, +1.0 retro
  const notYet = regularizedRefit(mk("not-yet"), defaultState());  // never paid off, 0.0

  // Because the delayed HitOutcome carries the ORIGINAL facetProfileAtCapture,
  // its high-surprise facet is credited — surp rises. The not-yet control does
  // the opposite. This is the mechanism that stops the loop hating slow burns.
  assert.ok(delayed.weights.surp > RATIFIED_WEIGHTS.surp, "delayed credits original high-surprise profile");
  assert.ok(notYet.weights.surp < delayed.weights.surp, "unrewarded profile does not gain the same credit");
});

// ── PROOF 4: exploration keeps high-distance regions sampled ────────────────
test("exploration reserve keeps under-sampled far regions in contention even when hits skew close", () => {
  // Recent hits skew CLOSE: close region saturated, far region barely sampled.
  const counts = new Map([["close:hi", 60], ["band:hi", 15], ["far:hi", 1]]);
  const closeProfile = { type: "B", d_idea: 0.08, surprise: 5, impact: 5, generality: "vertical", serendipityPotential: 5 };
  const farProfile = { type: "B", d_idea: 0.9, surprise: 5, impact: 5, generality: "vertical", serendipityPotential: 5 };
  assert.equal(regionKey(closeProfile), "close:hi");
  assert.equal(regionKey(farProfile), "far:hi");

  const state = defaultState();
  // Pure exploitation prefers the close (cliché) region — exactly the trap.
  const closeExploit = acquisitionScore(closeProfile, state, counts, { explore: false }).score;
  const farExploit = acquisitionScore(farProfile, state, counts, { explore: false }).score;
  assert.ok(closeExploit >= farExploit, "pure exploit favors the over-sampled close region");

  // The exploration bonus is larger for the under-sampled far/high-surprise region…
  assert.ok(explorationBonus(farProfile, counts) > explorationBonus(closeProfile, counts), "far under-sampled → bigger bonus");

  // …and with exploration on, the far frontier now wins acquisition — the loop
  // cannot collapse toward past (close) winners.
  const closeAcq = acquisitionScore(closeProfile, state, counts).score;
  const farAcq = acquisitionScore(farProfile, state, counts).score;
  assert.ok(farAcq > closeAcq, "exploration flips selection toward the far frontier");
});

// ── PO diff-ratify hook ─────────────────────────────────────────────────────
test("PO diff-ratify: small changes auto-apply, large shifts escalate", () => {
  const oldS = defaultState();
  const small = defaultState();
  small.weights = { ...small.weights, dist: 0.30, surp: 0.23 }; // ±0.02 each
  const smallDiff = proposeWeightUpdate(oldS, small);
  assert.equal(smallDiff.autoApplicable, true);
  assert.equal(smallDiff.escalated.length, 0);

  const big = defaultState();
  big.weights = { ...big.weights, dist: 0.40 }; // +0.12 > 0.05 bound
  const bigDiff = proposeWeightUpdate(oldS, big);
  assert.equal(bigDiff.autoApplicable, false);
  assert.ok(bigDiff.escalated.some((c) => c.param === "w_dist"), "large w_dist shift flagged for PO");
});

test("orchestrated refit holds escalated params, applies within-bound ones, keeps sum=1", () => {
  // Overdrive the learning rate so the proposal exceeds the auto-apply bound.
  const loop = createSteeringLoop({ lastFitAt: 0, guardrails: { LEARNING_RATE: 4, AUTO_APPLY_BOUND: 0.001 } });
  for (let i = 0; i < 20; i++) {
    loop.ingest(outcome(`s${i}`, { d_idea: 0.37, surprise: 5, realizedHit: "strong" }));
  }
  const r = loop.refit(DAY);
  assert.equal(r.fitted, true);
  assert.ok(r.diff.escalated.length > 0, "some params escalated to PO");
  assert.equal(r.applied, "partial");
  assert.ok(Math.abs(wsum(loop.getState().weights) - 1) < 1e-9, "invariant preserved after partial apply");
});

// ── band anti-collapse guard ────────────────────────────────────────────────
test("band center never collapses toward d→0 even under all-close hits", () => {
  // Feed a long run of close-distance hits; c must stay ≥ BAND_C_MIN.
  let state = defaultState();
  for (let cycle = 0; cycle < 30; cycle++) {
    const stream = Array.from({ length: 20 }, (_, i) =>
      outcome(i, { d_idea: 0.05, surprise: 5, realizedHit: "strong" }));
    state = regularizedRefit(stream, state);
    assert.ok(state.band.c >= GUARDRAILS.BAND_C_MIN - 1e-9, `c held above collapse floor (cycle ${cycle}: ${state.band.c})`);
  }
  assert.ok(state.band.c < RATIFIED_BAND.c, "c did drift downward (learning happens) but stayed above the floor");
});

test("featureVector exposes the five interpretable sub-scores", () => {
  const x = featureVector({ d_idea: 0.5, surprise: 5, impact: 10, generality: "universal", serendipityPotential: 10 });
  assert.deepEqual(Object.keys(x).sort(), ["dist", "gen", "imp", "sp", "surp"]);
  assert.ok(x.dist > 0.99 && x.surp === 1 && x.imp === 1 && x.gen === 1 && x.sp === 1);
});
