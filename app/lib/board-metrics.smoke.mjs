// board-metrics.smoke.mjs — S2-4 standalone smoke test.
// ============================================================================
// No React harness exists for the board, so this exercises the EXACT functions
// the UI + engine call, proving THE GATE ("Emitted ≠ counted (yet)"):
//
//   1. An `emitted` (pre-triage) item contributes EXACTLY 0 to domain density
//      and is ABSENT from the funnel `captured` denominator.
//   2. After triage (`emitted → New`, facets bound), the SAME item contributes
//      its ValueScore to density and enters `captured`.
//   3. The emitter-backlog counts emitted items as volume, but that volume
//      NEVER feeds value-weighted density (density excludes them structurally).
//   4. The gate is a null score, not a fraction, and not exclusion — the item
//      is fully scoreable the instant it is triaged.
//
// Run:  node app/lib/board-metrics.smoke.mjs
// ============================================================================

import { scoreDiscovery, PRE_TRIAGE_STATUS } from "./board-scoring.mjs";
import {
  densityByDomain,
  domainDensity,
  funnelMetrics,
  triagePromotionPatch,
  isCaptured,
  isEmitterBacklog,
} from "./board-metrics.mjs";

let passed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };
const ok   = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg));
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const DOMAIN = "04 · Demand Scanner";

// A well-characterized discovery living in DOMAIN — the SAME facet profile is
// used for the emitted item and the triaged item, so the ONLY thing that changes
// across the gate is `status`. That isolates the gate as the cause.
const facets = {
  type: "B", surprise: 4, generality: "platform",
  distanceBand: "serendipity-band", domainDistance: 0.5,
  domains: [{ name: DOMAIN, primary: true }],
};

// Pre-triage ambient capture: status `emitted`, captureMode ambient-emitter,
// but carrying the same facets (to prove the score is withheld by STATUS, not by
// missing facets).
const emitted = { id: "E1", status: PRE_TRIAGE_STATUS, captureMode: "ambient-emitter", ...facets };
// The same item after triage promotion → `new`.
const triaged = { id: "E1", ...facets, ...triagePromotionPatch(emitted, facets, "2026-07-29") };

// A couple of already-captured neighbors in the same domain (so density has a
// baseline the emitted item must NOT inflate).
const neighborA = { id: "N1", status: "reviewing", captureMode: "deliberate-scan", ...facets };
const neighborB = { id: "N2", status: "active", captureMode: "deliberate-scan", decision: "IMPLEMENT", ...facets };

// ── 0. The gate at the score level ───────────────────────────────────────────
console.log("0. Gate at the ValueScore path");
{
  assert(scoreDiscovery(emitted) === null,
    "emitted item has NO ValueScore (null = not scored yet)");
  const t = scoreDiscovery(triaged);
  assert(typeof t === "number" && t > 0,
    `triaged item HAS a positive ValueScore (${t.toFixed(3)})`);
  assert(isEmitterBacklog(emitted) && !isCaptured(emitted),
    "emitted is emitter-backlog and NOT captured");
  assert(!isEmitterBacklog(triaged) && isCaptured(triaged),
    "triaged is captured and NOT backlog");
}

// ── 1. Emitted contributes 0 to density; not in captured ─────────────────────
console.log("1. Emitted ≠ counted (yet): density 0 + absent from captured");
{
  const baseline = domainDensity([neighborA, neighborB], DOMAIN);
  const withEmitted = domainDensity([neighborA, neighborB, emitted], DOMAIN);
  assert(approx(baseline, withEmitted),
    `adding an emitted item leaves density unchanged (${baseline.toFixed(3)} = ${withEmitted.toFixed(3)})`);

  const m = funnelMetrics([neighborA, neighborB, emitted]);
  assert(m.funnel.captured === 2,
    `captured denominator = 2 (the two neighbors), emitted excluded (got ${m.funnel.captured})`);
  assert(m.emitterBacklog === 1,
    `emitter-backlog volume = 1 (the emitted item) (got ${m.emitterBacklog})`);
  assert(!m.density.has(DOMAIN) || approx(m.density.get(DOMAIN), baseline),
    "emitted item did not add to weighted domain density");
}

// ── 2. After triage the same item DOES count ─────────────────────────────────
console.log("2. Triage promotion makes it count");
{
  const before = domainDensity([neighborA, neighborB], DOMAIN);
  const after = domainDensity([neighborA, neighborB, triaged], DOMAIN);
  const contrib = scoreDiscovery(triaged);
  assert(after > before && approx(after - before, contrib),
    `triaged item adds exactly its ValueScore to density (Δ=${(after - before).toFixed(3)} = ${contrib.toFixed(3)})`);

  const m = funnelMetrics([neighborA, neighborB, triaged]);
  assert(m.funnel.captured === 3,
    `captured now = 3 (triaged item entered the funnel) (got ${m.funnel.captured})`);
  assert(m.emitterBacklog === 0,
    `emitter-backlog now = 0 (no pre-triage items left) (got ${m.emitterBacklog})`);
}

// ── 3. Backlog volume never feeds density (flood test) ───────────────────────
console.log("3. Emitter-backlog volume cannot fake a cluster");
{
  const flood = Array.from({ length: 50 }, (_, i) => ({
    id: `F${i}`, status: PRE_TRIAGE_STATUS, captureMode: "ambient-emitter", ...facets,
  }));
  const corpus = [neighborA, neighborB, ...flood];
  const m = funnelMetrics(corpus);
  const baseline = domainDensity([neighborA, neighborB], DOMAIN);
  assert(m.emitterBacklog === 50,
    `50 ambient captures counted as backlog volume (got ${m.emitterBacklog})`);
  assert(approx(m.density.get(DOMAIN) || 0, baseline),
    "a flood of 50 emitted captures adds 0 to weighted density (anti-inflation holds)");
  assert(m.funnel.captured === 2,
    `captured denominator stays 2 despite the flood (got ${m.funnel.captured})`);
}

// ── 4. captureMode slicing + shipped ─────────────────────────────────────────
console.log("4. captureMode slicing");
{
  const m = funnelMetrics([neighborA, neighborB, emitted]);
  assert(m.byCaptureMode["ambient-emitter"].emitterBacklog === 1,
    "ambient-emitter slice shows 1 backlog item");
  assert(m.byCaptureMode["ambient-emitter"].captured === 0,
    "ambient-emitter slice has 0 captured (it is still pre-triage)");
  assert(m.byCaptureMode["deliberate-scan"].captured === 2,
    "deliberate-scan slice shows 2 captured");
  assert(m.funnel.shipped === 1,
    `shipped = 1 (the active + IMPLEMENT neighbor) (got ${m.funnel.shipped})`);
}

// ── 5. Nullable-safety over legacy/degenerate shapes ─────────────────────────
console.log("5. Nullable-safe over legacy corpus");
{
  const legacy = [
    { id: "L1", type: "C", priorityScore: 32 },       // no status/domains
    { id: "L2", status: "banked" },                    // no facets
    null,                                              // defensive
    { id: "L3", status: PRE_TRIAGE_STATUS },           // emitted, no facets
  ].filter(Boolean);
  let threw = false;
  let m;
  try { m = funnelMetrics(legacy); } catch { threw = true; }
  assert(!threw, "funnelMetrics does not throw on legacy/degenerate items");
  assert(m.emitterBacklog === 1, "one facet-less emitted item still counts as backlog");
  assert(m.funnel.captured === 2, "the two non-emitted legacy items are captured");
}

console.log(`\n${process.exitCode ? "FAILED" : `PASSED — ${passed} assertions`}`);
