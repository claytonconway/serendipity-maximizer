// triage.smoke.mjs — S3-3 standalone smoke test (two-tier triage).
// ============================================================================
// No React harness exists for the board, so this exercises the EXACT functions
// the UI would call, proving the S3-3 contract on top of the S2-4 gate:
//
//   1. TIER 1 (autoFacets) returns a PROVISIONAL distanceBand + numeric
//      idea-distance + provisional surprise/impact for an `emitted` note,
//      fully OFFLINE (local hash-embedding fallback — no network/keys), and
//      it does NOT open the gate (the note still scores null).
//   2. TIER 2 (confirmTriage) promotes `emitted → New`, binds the confirmed
//      facets (via board-metrics.triagePromotionPatch), and the SAME item now
//      scores → contributes to weighted density + enters the funnel `captured`.
//   3. Provisional (Tier 1) and confirmed (Tier 2) are DISTINGUISHABLE — the
//      guess is flagged `provisional` and parked off the facet fields; the
//      confirmed note carries no provisional marker and no leftover suggestion.
//
// Run:  node app/lib/triage.smoke.mjs
// ============================================================================

import {
  autoFacets,
  confirmTriage,
  attachSuggestion,
  isProvisional,
  isTriaged,
  sanitizeConfirmedFacets,
  PROVISIONAL_FLAG,
  SUGGESTION_FIELD,
} from "./triage.mjs";
import { ingestCapture, manualSource } from "./ingest.mjs";
import { scoreDiscovery, isPreTriage } from "./board-scoring.mjs";
import { domainDensity, funnelMetrics } from "./board-metrics.mjs";
import { BANDS } from "./semantic-convergence.mjs";

let passed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };
const ok   = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg));
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const DOMAIN = "04 · Demand Scanner";
const VALID_BANDS = new Set(Object.values(BANDS));

// A real `emitted` note straight out of the S3-1 ingest path (status "emitted",
// facets UNBOUND). This is exactly what the ambient emitter / a connector drops.
const emitted = ingestCapture(
  { title: "Tardigrade cryptobiosis applied to vaccine cold-chain logistics", summary: "desiccation-tolerance proteins as a room-temp stabilizer", tags: ["biology", "logistics"] },
  { source: manualSource, now: "2026-07-29T00:00:00Z" }
);

// ── 1. TIER 1: provisional auto-facets, offline, gate still closed ───────────
console.log("1. Tier 1 — cheap provisional auto-facets (offline)");
{
  const s = autoFacets(emitted); // no corpus, no provider → local fallback, offline
  assert(VALID_BANDS.has(s.distanceBand),
    `suggests a provisional distanceBand ("${s.distanceBand}")`);
  assert(typeof s.domainDistance === "number" && s.domainDistance >= 0 && s.domainDistance <= 2,
    `suggests a numeric idea-distance (domainDistance=${s.domainDistance.toFixed(3)})`);
  assert(typeof s.surprise === "number" && s.surprise >= 1 && s.surprise <= 5,
    `suggests a provisional surprise on 1..5 (${s.surprise})`);
  assert(typeof s.impact === "number" && s.impact >= 1 && s.impact <= 10,
    `suggests a provisional impact on 1..10 (${s.impact})`);
  assert(s[PROVISIONAL_FLAG] === true && isProvisional(s),
    "the suggestion is flagged provisional");
  // Determinism: recomputing yields identical geometry (no RNG, no clock).
  const s2 = autoFacets(emitted);
  assert(s.distanceBand === s2.distanceBand && approx(s.domainDistance, s2.domainDistance),
    "auto-facets are deterministic across runs");
  // The gate is untouched: computing a suggestion does NOT score the note.
  assert(isPreTriage(emitted) && scoreDiscovery(emitted) === null,
    "Tier 1 does NOT open the gate — the emitted note still scores null");
}

// ── 1b. Novelty distance uses the corpus (nearest-neighbour) ─────────────────
console.log("1b. Tier 1 — corpus novelty distance");
{
  // A near-duplicate corpus neighbour should pull the provisional distance DOWN
  // (toward "too-close"); an unrelated corpus should not.
  const nearDup = ingestCapture(
    { title: "Tardigrade cryptobiosis applied to vaccine cold-chain logistics stabilizer", summary: "desiccation tolerance proteins room temp" },
    { source: manualSource, now: "2026-07-29T00:00:00Z", id: "NEAR" }
  );
  const dNear = autoFacets(emitted, [nearDup]);
  assert(dNear.distanceSource === "corpus-novelty",
    "with a corpus, distance derives from nearest-neighbour novelty");
  const dAlone = autoFacets(emitted, []);
  assert(dNear.domainDistance < dAlone.domainDistance,
    `a near-duplicate neighbour lowers the provisional distance (${dNear.domainDistance.toFixed(3)} < ${dAlone.domainDistance.toFixed(3)})`);
}

// ── 2. TIER 2: confirm promotes emitted→New, binds facets, item now scores ───
console.log("2. Tier 2 — fast human confirm promotes + materializes the score");
{
  // Human confirms: accepts the geometry, sets a real surprise/impact + domain.
  const suggestion = autoFacets(emitted);
  const confirmed = {
    ...suggestion,           // human starts from the provisional guess…
    surprise: 5, impact: 8,  // …and overrides with real judgement
    type: "B", generality: "platform",
    domains: [{ name: DOMAIN, primary: true }],
  };
  const triaged = confirmTriage(emitted, confirmed, { date: "2026-07-29" });

  assert(triaged.status === "new",
    "confirmTriage promotes emitted → New");
  assert(triaged.triagedDate === "2026-07-29",
    "triagedDate is stamped at confirm time (caller-supplied clock)");
  assert(triaged.surprise === 5 && triaged.impact === 8 && triaged.distanceBand === suggestion.distanceBand,
    "confirmed facets are bound onto the note (surprise/impact/distanceBand)");

  const score = scoreDiscovery(triaged);
  assert(typeof score === "number" && score > 0,
    `the SAME item now has a positive ValueScore (${score.toFixed(3)})`);

  // It now contributes to weighted density and enters the funnel `captured`.
  const before = domainDensity([], DOMAIN);
  const after = domainDensity([triaged], DOMAIN);
  assert(after > before && approx(after - before, score),
    `triaged item adds exactly its ValueScore to density (Δ=${(after - before).toFixed(3)})`);
  const m = funnelMetrics([emitted, triaged]);
  assert(m.funnel.captured === 1 && m.emitterBacklog === 1,
    `funnel: triaged item captured (1), the still-emitted one is backlog (1) (got captured=${m.funnel.captured}, backlog=${m.emitterBacklog})`);
}

// ── 3. Provisional vs confirmed are DISTINGUISHABLE ──────────────────────────
console.log("3. Provisional (guess) vs confirmed (fact) never blur");
{
  const suggestion = autoFacets(emitted);
  assert(isProvisional(suggestion), "Tier-1 output identifies as provisional");

  // A suggestion parked on the note stays OUTSIDE the facet fields → gate holds.
  const withSug = attachSuggestion(emitted);
  assert(withSug[SUGGESTION_FIELD] && isProvisional(withSug[SUGGESTION_FIELD]),
    "attachSuggestion parks the provisional guess under a namespaced field");
  assert(isPreTriage(withSug) && scoreDiscovery(withSug) === null,
    "a note carrying a suggestion is still emitted + still scores null (gate intact)");
  assert(withSug.surprise === undefined && withSug.distanceBand === undefined,
    "the parked guess does NOT bind onto the note's real facet fields");

  // Confirming strips ALL provisional bookkeeping — no marker survives.
  const triaged = confirmTriage(emitted, { ...suggestion, domains: [{ name: DOMAIN, primary: true }] }, { date: "2026-07-29" });
  assert(!isProvisional(triaged) && triaged[PROVISIONAL_FLAG] === undefined,
    "the confirmed note carries NO provisional marker");
  assert(triaged.distanceSource === undefined && triaged.rationale === undefined && triaged[SUGGESTION_FIELD] === undefined,
    "confirm strips provisional meta (distanceSource / rationale / parked suggestion)");
  assert(isTriaged(triaged) && !isTriaged(emitted),
    "isTriaged distinguishes the confirmed note from the emitted one");

  // sanitizeConfirmedFacets keeps only scoreable facets, drops the guess meta.
  const clean = sanitizeConfirmedFacets(suggestion);
  assert(clean[PROVISIONAL_FLAG] === undefined && clean.rationale === undefined && clean.distanceSource === undefined,
    "sanitizeConfirmedFacets removes every provisional-meta key");
  assert(clean.distanceBand === suggestion.distanceBand && clean.surprise === suggestion.surprise,
    "sanitizeConfirmedFacets keeps the real scoreable facets");
}

// ── 4. Nullable-safety / guards ──────────────────────────────────────────────
console.log("4. Nullable-safe + guards");
{
  let threw = false;
  try { autoFacets({ status: "emitted" }); } catch { threw = true; }
  assert(!threw, "autoFacets does not throw on a facet-less note");

  // Non-emitted note is refused by default (only `emitted` is triaged).
  let guarded = false;
  try { confirmTriage({ id: "X", status: "new" }, {}); } catch { guarded = true; }
  assert(guarded, "confirmTriage refuses a non-emitted note unless allowRetriage");

  // attachSuggestion leaves a non-emitted note untouched.
  const nonEmit = { id: "Y", status: "active" };
  assert(attachSuggestion(nonEmit) === nonEmit,
    "attachSuggestion is a no-op on a non-emitted note");
}

console.log(`\n${process.exitCode ? "FAILED" : `PASSED — ${passed} assertions`}`);
