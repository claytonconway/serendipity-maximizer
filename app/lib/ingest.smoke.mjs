// ingest.smoke.mjs — S3-1 standalone smoke test for the ingest contract.
// ============================================================================
// Proves the connector-agnostic capture-ingest contract, driving the SAME S2-4
// pipeline the board runs (imported from board-metrics.mjs — no reimplementation):
//
//   (a) A capture via the contract creates a WELL-FORMED `emitted` prov:Entity
//       note (status/captureMode/source/provenance all correct).
//   (b) It contributes EXACTLY 0 to density AND the funnel `captured`
//       denominator until triaged — the gate holds via the real S2-4 path —
//       then contributes its ValueScore the moment it is triaged.
//   (c) SOURCE-AGNOSTIC: two DIFFERENT `source` values both produce valid
//       emitted notes through ONE code path (ingestCapture), and both gate out.
//   (d) The CaptureSource interface accepts a brand-NEW adapter with NO core
//       edit — a fresh source defined in this test file ingests cleanly.
//
// Run:  node app/lib/ingest.smoke.mjs
// ============================================================================

import {
  ingestCapture,
  ingestFrom,
  defineSource,
  manualSource,
  IngestContractError,
} from "./ingest.mjs";
import { PRE_TRIAGE_STATUS, scoreDiscovery, isPreTriage } from "./board-scoring.mjs";
import {
  funnelMetrics,
  densityByDomain,
  triagePromotionPatch,
  isCaptured,
  isEmitterBacklog,
} from "./board-metrics.mjs";

let passed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };
const ok   = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg));
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const NOW = "2026-07-29T12:00:00.000Z"; // caller-supplied clock (module reads none)
const DOMAIN = "07 · Field Sensing";

// ── (a) Well-formed emitted prov:Entity via the contract ─────────────────────
console.log("\n(a) contract produces a well-formed emitted prov:Entity note");
const note = ingestFrom(manualSource, "Kelp canopy density as a carbon proxy", { now: NOW });
assert(note.status === PRE_TRIAGE_STATUS && note.status === "emitted",
  "status is 'emitted' (pre-triage entry state)");
assert(note.captureMode === "ambient-emitter",
  "captureMode defaults to ambient-emitter (lands where the in-app emitter does)");
assert(note.source === "manual", "source id is carried as a plain field");
assert(isNonEmpty(note.title), "title is carried from the normalized payload");
assert(note.provenance && note.provenance["@type"] === "prov:Entity",
  "note is a prov:Entity");
const act = note.provenance.wasGeneratedBy;
assert(act && Array.isArray(act["@type"]) && act["@type"].includes(":CaptureActivity"),
  "prov:wasGeneratedBy a :CaptureActivity");
assert(act.captureMode === "ambient-emitter" && act.source === "manual",
  ":CaptureActivity carries captureMode + the source id");
assert(note.provenance.generatedAtTime === NOW && note.discoveredDate === NOW,
  "prov:generatedAtTime = caller-supplied capturedAt (no clock read in-module)");
assert(Array.isArray(note.domains) && note.domains.length === 0,
  "S2-1 facets are UNBOUND at capture (bound later at triage)");

// ── (c) SOURCE-AGNOSTIC: two different sources, ONE code path ─────────────────
console.log("\n(c) source-agnostic — two different sources, one ingestCapture path");
// A second adapter, shaped nothing like `manual`, defined right here.
const rssSource = defineSource({
  id: "example-feed",
  label: "Example feed",
  normalize(raw) {
    // raw is a fake feed item — a DIFFERENT native shape than manual's string.
    return {
      title: raw.headline,
      summary: raw.blurb,
      capturedAt: raw.ts,
      externalId: raw.guid,
      tags: raw.topics,
    };
  },
});
const noteA = ingestCapture(manualSource.normalize({
  title: "Tide-gauge anomaly clustering", externalId: "m-1",
}), { source: manualSource, now: NOW });
const noteB = ingestFrom(rssSource, {
  headline: "Bioluminescence bloom tracking", blurb: "night sensing",
  ts: NOW, guid: "feed-42", topics: ["sensing"],
}, {});
assert(noteA.source === "manual" && noteB.source === "example-feed",
  "two DIFFERENT source values land on the notes");
assert(noteA.status === "emitted" && noteB.status === "emitted",
  "both notes are 'emitted' through the SAME code path");
assert(noteA.provenance.wasGeneratedBy.source === "manual" &&
       noteB.provenance.wasGeneratedBy.source === "example-feed",
  "each :CaptureActivity carries its own source id");
assert(noteB.id === "example-feed:feed-42",
  "externalId yields a stable, source-namespaced note id");

// ── (d) A brand-new adapter is drop-in with NO core edit ─────────────────────
console.log("\n(d) CaptureSource interface accepts a new adapter with no core edit");
// This adapter did not exist when ingest.mjs was written — it slots in here.
const slackish = defineSource({
  id: "slackish",
  normalize: (raw) => ({ title: raw.text, capturedAt: raw.at, externalId: raw.id }),
});
const noteC = ingestFrom(slackish, { text: "note from a chat", at: NOW, id: "c9" }, {});
assert(noteC.source === "slackish" && noteC.status === "emitted" &&
       noteC.provenance.wasGeneratedBy.source === "slackish",
  "the new adapter ingests cleanly with zero changes to ingest.mjs");
// Contract enforcement: a malformed adapter/payload fails loudly + typed.
assert(threw(() => defineSource({ id: "bad" })),
  "defineSource rejects an adapter missing normalize()");
assert(threw(() => ingestCapture({ /* no title */ }, { source: manualSource })),
  "ingestCapture rejects a payload with no title");

// ── (b) THE GATE via the real S2-4 pipeline ──────────────────────────────────
console.log("\n(b) gate holds via the real S2-4 pipeline (Emitted ≠ counted yet)");
// A corpus: the three ingested emitted notes + one already-captured discovery so
// density/funnel have a non-zero baseline to compare against.
const captured = {
  id: "DISC-100", title: "baseline captured discovery", status: "active",
  captureMode: "deliberate-scan", decision: "IMPLEMENT",
  type: "B", surprise: 4, generality: "platform",
  distanceBand: "serendipity-band", domainDistance: 0.5,
  domains: [{ name: DOMAIN, primary: true }],
};
// Put an ingested note in the SAME domain so we can prove it adds 0 to it.
const ingestedInDomain = ingestCapture(
  manualSource.normalize({ title: "ingested, awaiting triage", externalId: "g-1" }),
  { source: manualSource, now: NOW }
);
const corpus = [captured, note, noteA, noteB, noteC, ingestedInDomain];

// Every ingested note reads as pre-triage / emitter-backlog, never captured.
for (const n of [note, noteA, noteB, noteC, ingestedInDomain]) {
  assert(isPreTriage(n) && isEmitterBacklog(n) && !isCaptured(n),
    `ingested "${n.id}" is pre-triage backlog, not captured`);
  assert(scoreDiscovery(n) === null,
    `ingested "${n.id}" has a NULL ValueScore (gate: not scored yet)`);
}

const m = funnelMetrics(corpus);
assert(m.total === 6, "funnel sees all 6 items");
assert(m.emitterBacklog === 5, "5 ingested emitted notes counted as UNWEIGHTED backlog");
assert(m.funnel.captured === 1,
  "funnel `captured` = 1 (only the baseline; all 5 ingested notes gate OUT)");
assert(m.funnel.shipped === 1, "baseline IMPLEMENT still ships; ingest changed nothing downstream");

const densBefore = densityByDomain(corpus).get(DOMAIN) || 0;
const baselineOnly = densityByDomain([captured]).get(DOMAIN) || 0;
assert(approx(densBefore, baselineOnly),
  "domain density = baseline ALONE — the ingested note in that domain adds 0");

// Now TRIAGE the ingested note (emitted → New, binding facets) via the S2-4 patch
// and prove the SAME item now contributes its ValueScore — gate was a hold, not
// an exclusion.
const patch = triagePromotionPatch(ingestedInDomain, {
  type: "B", surprise: 4, generality: "platform",
  distanceBand: "serendipity-band", domainDistance: 0.5,
  domains: [{ name: DOMAIN, primary: true }],
}, "2026-07-29");
const triaged = { ...ingestedInDomain, ...patch };
assert(triaged.status === "new" && isCaptured(triaged),
  "after triage the ingested note is captured (emitted → new)");
assert(typeof scoreDiscovery(triaged) === "number",
  "after triage it has a real ValueScore (the gate materializes on triage)");
const corpusAfter = [captured, triaged];
const densAfter = densityByDomain(corpusAfter).get(DOMAIN) || 0;
assert(densAfter > densBefore,
  "after triage the SAME note now ADDS to domain density (hold, not exclusion)");
const mAfter = funnelMetrics(corpusAfter);
assert(mAfter.funnel.captured === 2,
  "after triage `captured` rises to 2 — the ingested note entered the funnel");

console.log(`\n✓ ingest contract: ${passed} checks passed.`);
if (process.exitCode) console.error("✗ SOME CHECKS FAILED");

// ── tiny local helpers (kept at the bottom; no deps) ─────────────────────────
function isNonEmpty(x) { return typeof x === "string" && x.trim().length > 0; }
function threw(fn) {
  try { fn(); return false; }
  catch (e) { return e instanceof IngestContractError; }
}
