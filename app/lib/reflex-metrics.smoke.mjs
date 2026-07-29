// reflex-metrics.smoke.mjs — S3-4 standalone smoke test.
// ============================================================================
// Exercises the EXACT reflexVsRitual() path over a rigged synthetic corpus,
// proving the "reflex vs ritual" comparison:
//
//   1. Cohorts PARTITION correctly: ambient = captureMode "ambient-emitter";
//      deliberate = deliberate-scan / manual / missing (legacy).
//   2. promotionRate = reached-Active / captured (spec §1.1), gate-applied
//      (pre-triage `emitted` sits in emitterBacklog, out of `captured`).
//   3. convergenceRate = cohort share landing in a geometric :Convergence
//      (reused semantic-convergence — a 3-member, 3-distinct-domain component).
//   4. bridgeRate = cohort share whose primary domain is on a cross-domain
//      serendipity-band bridge (reused analyzeDiscoveries domain geometry).
//   5. delta = ambient − deliberate is POSITIVE on all three rates for a corpus
//      deliberately rigged so the reflex out-performs the ritual.
//
// The domain summaries are engineered so the deterministic LocalHashEmbedding
// yields cos(DA,DB)=0.5 (distance 0.5 → serendipity bridge) and DC unrelated to
// both (distance 1.0 → too-far, NOT a bridge). No network, no clock, no RNG.
//
// Run:  node app/lib/reflex-metrics.smoke.mjs
// ============================================================================

import { reflexVsRitual, cohortOf, AMBIENT_MODE } from "./reflex-metrics.mjs";

let passed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg));
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// Engineered domain descriptors (see header): DA & DB share 2 tokens + 2 unique
// each → cosine 0.5 → serendipity bridge; DC shares nothing → too-far.
const DA = "converge converge reef reef";
const DB = "converge converge kelp kelp";
const DC = "sand sand dune dune";

const dom = (name) => [{ name, primary: true }];

// ── The corpus ───────────────────────────────────────────────────────────────
// AMBIENT cohort (the reflex). A1/A2/A3 form a converges-with component spanning
// 3 distinct domains (DA, DB, DC) → fires a :Convergence. A1/A2 reach Active
// (pursued); A3 only Team-Triage; A4 is captured-only; A5 is pre-triage backlog.
const ambient = [
  { id: "A1", captureMode: "ambient-emitter", status: "active", decision: "IMPLEMENT",
    domains: dom("DA"), summary: DA,
    relations: [{ kind: "converges-with", toId: "A2" }, { kind: "converges-with", toId: "A3" }] },
  { id: "A2", captureMode: "ambient-emitter", status: "active",
    domains: dom("DB"), summary: DB,
    relations: [{ kind: "converges-with", toId: "A1" }, { kind: "converges-with", toId: "A3" }] },
  { id: "A3", captureMode: "ambient-emitter", status: "team_triage",
    domains: dom("DC"), summary: DC,
    relations: [{ kind: "converges-with", toId: "A1" }, { kind: "converges-with", toId: "A2" }] },
  { id: "A4", captureMode: "ambient-emitter", status: "new", domains: dom("DA"), summary: DA },
  { id: "A5", captureMode: "ambient-emitter", status: "emitted", domains: dom("DA"), summary: DA },
];

// DELIBERATE cohort (the ritual). All in DC (a non-bridge domain), none converge.
// D1 reaches Active; the rest are captured-only. D3 has NO captureMode → legacy →
// must count as deliberate. D2 is "manual". D1/D4 are "deliberate-scan".
const deliberate = [
  { id: "D1", captureMode: "deliberate-scan", status: "active", decision: "IMPLEMENT",
    domains: dom("DC"), summary: DC },
  { id: "D2", captureMode: "manual", status: "new", domains: dom("DC"), summary: DC },
  { id: "D3", status: "new", domains: dom("DC"), summary: DC }, // missing captureMode → legacy
  { id: "D4", captureMode: "deliberate-scan", status: "new", domains: dom("DC"), summary: DC },
];

const corpus = [...ambient, ...deliberate];

// ── Cohort classification is right (incl. legacy → deliberate) ────────────────
assert(cohortOf(ambient[0]) === "ambient", "ambient-emitter classifies as ambient");
assert(cohortOf(deliberate[2]) === "deliberate", "missing captureMode (legacy) classifies as deliberate");
assert(cohortOf(deliberate[1]) === "deliberate", "manual classifies as deliberate");
assert(AMBIENT_MODE === "ambient-emitter", "AMBIENT_MODE constant is ambient-emitter");

const r = reflexVsRitual(corpus);

// ── 1. Partition ──────────────────────────────────────────────────────────────
assert(r.ambient.n === 5, `ambient cohort n = 5 (got ${r.ambient.n})`);
assert(r.deliberate.n === 4, `deliberate cohort n = 4 (got ${r.deliberate.n})`);

// ── 2. Funnel counts + promotionRate (gate-applied) ───────────────────────────
assert(r.ambient.emitterBacklog === 1, `ambient emitterBacklog = 1 (A5 pre-triage) (got ${r.ambient.emitterBacklog})`);
assert(r.ambient.captured === 4, `ambient captured = 4 (A5 excluded by gate) (got ${r.ambient.captured})`);
assert(r.ambient.pursued === 2, `ambient pursued = 2 (A1,A2 Active) (got ${r.ambient.pursued})`);
assert(approx(r.ambient.promotionRate, 0.5), `ambient promotionRate = 2/4 = 0.5 (got ${r.ambient.promotionRate})`);
assert(r.deliberate.captured === 4, `deliberate captured = 4 (got ${r.deliberate.captured})`);
assert(r.deliberate.pursued === 1, `deliberate pursued = 1 (D1 Active) (got ${r.deliberate.pursued})`);
assert(approx(r.deliberate.promotionRate, 0.25), `deliberate promotionRate = 1/4 = 0.25 (got ${r.deliberate.promotionRate})`);

// ── 3. Convergence participation (reused engine) ──────────────────────────────
assert(r.totals.convergences === 1, `exactly 1 :Convergence fires (got ${r.totals.convergences})`);
assert(r.ambient.convergentCount === 3, `ambient convergentCount = 3 (A1,A2,A3) (got ${r.ambient.convergentCount})`);
assert(approx(r.ambient.convergenceRate, 3 / 5), `ambient convergenceRate = 3/5 = 0.6 (got ${r.ambient.convergenceRate})`);
assert(r.deliberate.convergentCount === 0, `deliberate convergentCount = 0 (got ${r.deliberate.convergentCount})`);
assert(approx(r.deliberate.convergenceRate, 0), `deliberate convergenceRate = 0 (got ${r.deliberate.convergenceRate})`);

// ── 4. Cross-domain bridge participation (reused geometry) ────────────────────
assert(r.totals.bridgeDomains === 2, `2 domains on a serendipity bridge: DA,DB (got ${r.totals.bridgeDomains})`);
// Ambient members on bridge domains: A1(DA),A2(DB),A4(DA),A5(DA)=4; A3(DC) not.
assert(r.ambient.bridgeCount === 4, `ambient bridgeCount = 4 (got ${r.ambient.bridgeCount})`);
assert(approx(r.ambient.bridgeRate, 4 / 5), `ambient bridgeRate = 4/5 = 0.8 (got ${r.ambient.bridgeRate})`);
assert(r.deliberate.bridgeCount === 0, `deliberate bridgeCount = 0 (all in DC, non-bridge) (got ${r.deliberate.bridgeCount})`);
assert(approx(r.deliberate.bridgeRate, 0), `deliberate bridgeRate = 0 (got ${r.deliberate.bridgeRate})`);

// ── 5. delta = ambient − deliberate, POSITIVE on the rigged case ──────────────
assert(approx(r.delta.promotionRate, 0.5 - 0.25) && r.delta.promotionRate > 0, `delta.promotionRate = +0.25 (reflex wins) (got ${r.delta.promotionRate})`);
assert(approx(r.delta.convergenceRate, 0.6) && r.delta.convergenceRate > 0, `delta.convergenceRate = +0.6 (reflex wins) (got ${r.delta.convergenceRate})`);
assert(approx(r.delta.bridgeRate, 0.8) && r.delta.bridgeRate > 0, `delta.bridgeRate = +0.8 (reflex wins) (got ${r.delta.bridgeRate})`);

// ── Sanity: every rate is a share in [0,1] ────────────────────────────────────
for (const c of ["ambient", "deliberate"]) {
  for (const k of ["promotionRate", "convergenceRate", "bridgeRate"]) {
    const v = r[c][k];
    assert(v >= 0 && v <= 1, `${c}.${k} in [0,1] (got ${v})`);
  }
}

// ── Seam / config surfaced for later cross-project work ───────────────────────
assert(/cross-domain/.test(r.config.bridgeScope), "config states bridgeScope is cross-domain (current)");
assert(/cross-project/i.test(r.config.crossProjectSeam), "config documents the cross-project seam");

// ── Empty corpus is nullable-safe (no throw, zeroed rates) ─────────────────────
const empty = reflexVsRitual([]);
assert(empty.ambient.n === 0 && empty.deliberate.n === 0 && empty.delta.promotionRate === 0,
  "empty corpus → zeroed comparison, no throw");

console.log(`\n${passed} checks passed${process.exitCode ? " — WITH FAILURES" : ""}.`);
