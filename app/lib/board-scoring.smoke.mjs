// board-scoring.smoke.mjs — S2-6 standalone smoke test.
// ============================================================================
// No React test harness exists for the board, so this exercises the EXACT
// functions app/discovery-board.jsx calls (imported from board-scoring.mjs) with
// board-shaped discovery objects, asserting:
//   1. ValueScore is always FINITE and nullable-safe (missing S2-1 facets ok).
//   2. The geometric ValueScore ranking behaves (mid-distance/high-surprise
//      outranks a too-close/low-surprise restatement — similarity ≠ serendipity).
//   3. convergentDiscoveryIds fires the geometric :Convergence definition
//      (≥3 discoveries, ≥3 DISTINCT primary domains, linked converges-with) and
//      correctly does NOT fire on redundancy (only `bridges`, or <3 domains).
//
// Run:  node app/lib/board-scoring.smoke.mjs
// ============================================================================

import {
  valueScoreMap,
  scoreDiscovery,
  convergentDiscoveryIds,
  detectConvergences,
  defaultState,
} from "./board-scoring.mjs";

let passed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };
const ok   = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg));

// ── Board-shaped fixtures (mirror app/discovery-board.jsx SAMPLE shapes) ──────
// Rich, well-characterized discoveries (have the S2-1 facets):
const RICH = [
  { id: "D1", type: "B", surprise: 4, generality: "vertical",
    distanceBand: "serendipity-band", domainDistance: 0.52,
    domains: [{ name: "Physics", primary: true }] },
  { id: "D2", type: "B", surprise: 3, generality: "platform",
    distanceBand: "serendipity-band", domainDistance: 0.48,
    domains: [{ name: "Org Systems", primary: true }] },
  { id: "D3", type: "D", surprise: 2, generality: "vertical",
    distanceBand: "too-close", domainDistance: 0.21,
    domains: [{ name: "Demand", primary: true }] },
];
// Legacy discoveries missing every new facet (old localStorage shape):
const LEGACY = [
  { id: "L1", type: "C", priorityScore: 32 },   // no surprise/generality/band/domains
  { id: "L2", priorityScore: 10 },              // not even a type
  { id: "L3", type: "A", surprise: 5 },         // partial facets only
];

// ── 1. Nullable-safety: every score finite (or null), never NaN ──────────────
console.log("1. ValueScore is finite + nullable-safe");
{
  const all = [...RICH, ...LEGACY];
  const scores = valueScoreMap(all);
  let allFinite = true;
  for (const d of all) {
    const v = scores.get(d.id);
    if (!(typeof v === "number" && Number.isFinite(v))) { allFinite = false; }
    if (Number.isNaN(v)) fail(`${d.id} produced NaN`);
  }
  assert(allFinite, "all rich + legacy discoveries score to a finite number");
  assert(scores.get("L2") != null && Number.isFinite(scores.get("L2")),
    "a discovery with NO facets and no type still scores finitely");
  assert(Number.isFinite(scoreDiscovery({ id: "empty" })),
    "scoreDiscovery({}) is finite (never throws / NaN)");
  assert(scoreDiscovery(null) === null || Number.isFinite(scoreDiscovery(null)),
    "scoreDiscovery(null) is safe");
}

// ── 2. Ranking: serendipity-band + high surprise outranks too-close restatement
console.log("2. Geometric ValueScore ranking");
{
  const s = valueScoreMap(RICH);
  const d1 = s.get("D1"), d3 = s.get("D3");
  assert(d1 > d3,
    `mid-distance/high-surprise D1 (${d1.toFixed(3)}) > too-close/low-surprise D3 (${d3.toFixed(3)})`);
  // A richly-characterized serendipity discovery outscores a bare legacy record.
  const withLegacy = valueScoreMap([...RICH, ...LEGACY]);
  assert(withLegacy.get("D1") > withLegacy.get("L2"),
    "characterized serendipity D1 outranks facet-less legacy L2");
}

// ── 3. Geometric convergence detection (replaces manual boolean) ─────────────
console.log("3. convergentDiscoveryIds — geometric :Convergence");
{
  // FIRES: 3 discoveries, 3 distinct primary domains, mutually converges-with.
  const converge3 = [
    { id: "C1", domains: [{ name: "Bio", primary: true }],
      relations: [{ toId: "C2", kind: "converges-with" }] },
    { id: "C2", domains: [{ name: "Materials", primary: true }],
      relations: [{ toId: "C3", kind: "converges-with" }] },
    { id: "C3", domains: [{ name: "Policy", primary: true }],
      relations: [{ toId: "C1", kind: "converges-with" }] },
  ];
  const fired = convergentDiscoveryIds(converge3);
  assert(fired.has("C1") && fired.has("C2") && fired.has("C3"),
    "3 discoveries across 3 domains linked converges-with → all flagged convergent");
  assert(detectConvergences(converge3).length === 1,
    "exactly one :Convergence event detected");

  // DOES NOT FIRE: same 3 links but only 2 distinct domains (redundancy).
  const twoDomains = [
    { id: "T1", domains: [{ name: "Bio", primary: true }],
      relations: [{ toId: "T2", kind: "converges-with" }] },
    { id: "T2", domains: [{ name: "Bio", primary: true }],
      relations: [{ toId: "T3", kind: "converges-with" }] },
    { id: "T3", domains: [{ name: "Materials", primary: true }],
      relations: [{ toId: "T1", kind: "converges-with" }] },
  ];
  assert(convergentDiscoveryIds(twoDomains).size === 0,
    "3 discoveries but only 2 domains → NOT convergence (redundancy guard)");

  // DOES NOT FIRE: the board SAMPLE uses only `bridges` edges, no converges-with.
  const bridgesOnly = [
    { id: "B1", domains: [{ name: "Physics", primary: true }],
      relations: [{ toId: "B2", kind: "bridges" }] },
    { id: "B2", domains: [{ name: "Org", primary: true }],
      relations: [{ toId: "B3", kind: "bridges" }] },
    { id: "B3", domains: [{ name: "Cert", primary: true }], relations: [] },
  ];
  assert(convergentDiscoveryIds(bridgesOnly).size === 0,
    "`bridges`-only corpus (board SAMPLE shape) → no convergence fired");

  // Nullable-safe: legacy items with no domains/relations don't crash detection.
  assert(convergentDiscoveryIds(LEGACY).size === 0,
    "facet-less legacy corpus → no convergence, no throw");
}

console.log(`\n${process.exitCode ? "FAILED" : `PASSED — ${passed} assertions`}`);
