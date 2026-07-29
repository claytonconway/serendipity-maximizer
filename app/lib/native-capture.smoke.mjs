// native-capture.smoke.mjs — S3-2 standalone smoke test for the native
// capture connector. Proves the 6 RATIFIED privacy constraints in code, and
// proves the connector plugs into the S3-1 `defineSource` socket with ZERO
// edits to ingest.mjs (it imports the UNMODIFIED contract + real S2-4 pipeline).
//
// Run:  node app/lib/native-capture.smoke.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  NATIVE_SOURCE_ID,
  NATIVE_CAPTURE_TAG,
  BOARD_STORAGE_KEY,
  nativeSource,
  distill,
  isNativeCapture,
  createSurfaceRegistry,
  defaultRegistry,
  enableSurface,
  disableSurface,
  isSurfaceEnabled,
  captureSurprise,
  recordCapture,
  listNativeCaptures,
  purgeNativeCaptures,
} from "./native-capture.mjs";
// Import the UNMODIFIED S3-1 contract + real S2-4 gate pipeline — proving the
// connector rides them with no core edit.
import { defineSource, IngestContractError } from "./ingest.mjs";
import { isPreTriage, scoreDiscovery } from "./board-scoring.mjs";
import { funnelMetrics, isEmitterBacklog, isCaptured } from "./board-metrics.mjs";

let passed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };
const ok   = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg));

const NOW = "2026-07-29T12:00:00.000Z"; // caller-supplied clock (module reads none)

// A tiny in-memory stand-in for the board's async `window.storage` adapter
// ({ get(key) -> {value}, set(key, value) }). This is a TEST DOUBLE — the module
// itself adds no storage; it only reads/writes through an injected adapter.
function memStore(initialArr = null) {
  const map = new Map();
  if (initialArr) map.set(BOARD_STORAGE_KEY, JSON.stringify(initialArr));
  return {
    _map: map,
    async get(key) { return map.has(key) ? { value: map.get(key) } : null; },
    async set(key, value) { map.set(key, value); },
  };
}

// A distilled surprise input that ALSO smuggles raw-conversation-shaped fields.
// The connector must drop every one of these structurally.
const RAW_SENTINEL = "SECRET_RAW_TRANSCRIPT_LINE_should_never_be_stored";
const surpriseInput = () => ({
  what: "Tide-gauge noise floor tracks lunar phase",
  where: "while triaging sensor drift tickets",
  why: "a calibration artifact turned out to be a real signal",
  surface: "agent-worklog",
  capturedAt: NOW,
  externalId: "ns-1",
  tags: ["sensing"],
  // ↓ raw content the emitter must NOT be able to leak through the connector:
  transcript: RAW_SENTINEL,
  content: RAW_SENTINEL,
  messages: [{ role: "user", text: RAW_SENTINEL }],
  raw: { body: RAW_SENTINEL },
});

// ── Constraint 5: OPT-IN per surface, default OFF ────────────────────────────
console.log("\n(5) opt-in per surface — default OFF; only opted-in surface captures");
const reg = createSurfaceRegistry();
assert(reg.enabled().length === 0, "a fresh registry has NO enabled surfaces (default off)");
assert(reg.isEnabled("agent-worklog") === false, "surface is not enabled until opted in");
// Capture with an un-opted-in surface is a NO-OP (returns null, builds nothing).
assert(captureSurprise(surpriseInput(), { registry: reg, now: NOW }) === null,
  "captureSurprise is a NO-OP for a surface that is not opted in");
reg.enable("agent-worklog");
assert(reg.isEnabled("agent-worklog") === true, "enable() opts a surface in");
const note = captureSurprise(surpriseInput(), { registry: reg, now: NOW });
assert(note != null, "captureSurprise fires once the surface is opted in");
// A DIFFERENT, un-opted surface still does not fire even while another is on.
assert(captureSurprise({ ...surpriseInput(), surface: "other-surface" },
  { registry: reg, now: NOW }) === null,
  "a different, non-opted surface still does NOT capture (per-surface gating)");
reg.disable("agent-worklog");
assert(captureSurprise(surpriseInput(), { registry: reg, now: NOW }) === null,
  "disable() turns the surface back off (no capture)");
// The default (process-wide) registry is likewise off until enableSurface().
assert(isSurfaceEnabled("agent-worklog") === false,
  "the default registry is also OFF by default");
enableSurface("agent-worklog");
assert(isSurfaceEnabled("agent-worklog") === true, "enableSurface() opts in on the default registry");
disableSurface("agent-worklog");
assert(isSurfaceEnabled("agent-worklog") === false, "disableSurface() opts back out");

// ── Constraint 2: DISTILLED-ONLY — never raw conversation content ────────────
console.log("\n(2) distilled-only — the stored note carries what/where/why, never raw content");
assert(note.source === NATIVE_SOURCE_ID, "note.source is the native source id");
assert(note.title === "Tide-gauge noise floor tracks lunar phase",
  "title = the distilled `what` (the surprise headline)");
assert(note.summary.includes("Where:") && note.summary.includes("Why it surprised:"),
  "summary is a distilled where/why line");
// The core privacy assertion: NO raw field, and the raw sentinel appears NOWHERE
// on the stored note (deep scan of the serialized note).
const serialized = JSON.stringify(note);
assert(!serialized.includes(RAW_SENTINEL),
  "the raw transcript/content sentinel appears NOWHERE on the stored note");
for (const rawField of ["transcript", "content", "messages", "raw"]) {
  assert(!(rawField in note), `stored note has NO '${rawField}' field (raw shape dropped structurally)`);
}
// distill() in isolation also drops raw fields (unit-level guarantee).
const payload = distill(surpriseInput());
assert(!JSON.stringify(payload).includes(RAW_SENTINEL),
  "distill() output contains no raw content");
assert(!("transcript" in payload) && !("content" in payload) && !("raw" in payload),
  "distill() output has no raw fields — only distilled title/summary/tags/prov");

// ── Constraint 4: NEVER auto-public + private-to-user ────────────────────────
console.log("\n(4) never auto-public — no public flag, teamVisible:false (private board state)");
for (const publicish of ["public", "isPublic", "published", "shared", "visibility"]) {
  assert(!(publicish in note), `note carries NO '${publicish}' flag (never auto-public)`);
}
assert(note.teamVisible === false,
  "native capture is teamVisible:false — private-to-user (overrides S3-1 inherited true)");

// ── Plug-in proof: rides S3-1 `defineSource` + real S2-4 gate, no core edit ──
console.log("\n(plug-in) drops into the S3-1 socket + S2-4 gate with zero ingest.mjs edits");
// nativeSource is exactly what defineSource() produces — same shape as any adapter.
const reproduced = defineSource({ id: NATIVE_SOURCE_ID, normalize: distill });
assert(reproduced.id === nativeSource.id && typeof nativeSource.normalize === "function",
  "nativeSource is a standard defineSource() adapter (drop-in against S3-1)");
assert(note.status === "emitted" && isPreTriage(note),
  "the capture is an S3-1 `emitted` pre-triage note (rides the gate)");
assert(isEmitterBacklog(note) && !isCaptured(note),
  "it reads as UNWEIGHTED emitter backlog, not captured (gate: emitted ≠ counted)");
assert(scoreDiscovery(note) === null,
  "it has a NULL ValueScore until triaged (the S2-4 gate holds unchanged)");
assert(note.provenance && note.provenance["@type"] === "prov:Entity" &&
       note.provenance.wasGeneratedBy.source === NATIVE_SOURCE_ID,
  "it is a prov:Entity whose :CaptureActivity carries the native source id");
// The gate holds inside the REAL S2-4 funnel bundle.
const fm = funnelMetrics([note]);
assert(fm.emitterBacklog === 1 && fm.funnel.captured === 0,
  "in the real funnelMetrics: 1 backlog, 0 captured — capture gates out until triaged");

// ── Constraint 3 + 6: local adapter view + purge ────────────────────────────
console.log("\n(3,6) rides the local board adapter — list + purge the native log");
// Seed a store with a NON-native discovery so purge must leave it untouched.
const foreign = { id: "DISC-9", title: "human discovery", status: "active", source: "manual" };
const store = memStore([foreign]);
const reg2 = createSurfaceRegistry(["agent-worklog"]); // opted in
// recordCapture persists through the board's OWN adapter/key (no new storage).
const r1 = await recordCapture(store, surpriseInput(), { registry: reg2, now: NOW });
const r2 = await recordCapture(store, {
  what: "Second surprise", where: "code review", why: "unexpected reuse",
  surface: "agent-worklog", externalId: "ns-2", capturedAt: NOW,
}, { registry: reg2, now: NOW });
assert(r1 && r2, "recordCapture persisted two native captures via the local adapter");
// A no-op capture (surface off) writes NOTHING.
const before = JSON.parse((await store.get(BOARD_STORAGE_KEY)).value).length;
const noop = await recordCapture(store, { ...surpriseInput(), surface: "nope" },
  { registry: reg2, now: NOW });
const afterNoop = JSON.parse((await store.get(BOARD_STORAGE_KEY)).value).length;
assert(noop === null && before === afterNoop,
  "a non-opted-in recordCapture is a no-op — nothing written to the store");

const listed = await listNativeCaptures(store);
assert(listed.length === 2 && listed.every(isNativeCapture),
  "listNativeCaptures returns exactly the 2 native captures (view anytime)");
assert(listed.every((n) => n.teamVisible === false),
  "every listed native capture is private (teamVisible:false)");

// Purge: removes native captures, leaves the foreign discovery intact.
const purge = await purgeNativeCaptures(store);
assert(purge.removedCount === 2, "purge removed both native captures");
assert(purge.remaining === 1, "purge left the 1 non-native discovery untouched");
const afterList = await listNativeCaptures(store);
assert(afterList.length === 0, "the native capture log is empty after purge");
const survivors = JSON.parse((await store.get(BOARD_STORAGE_KEY)).value);
assert(survivors.length === 1 && survivors[0].id === "DISC-9",
  "the non-native discovery survives purge (purge is native-only)");

// ── Constraint 1: ZERO network — structural source scan ──────────────────────
console.log("\n(1) zero-network — the connector references NO remote-I/O API (structural)");
const modPath = fileURLToPath(new URL("./native-capture.mjs", import.meta.url));
const src = readFileSync(modPath, "utf8");
const NETWORK_TOKENS = [
  /\bfetch\s*\(/i,
  /XMLHttpRequest/i,
  /\bWebSocket\b/i,
  /\bEventSource\b/i,
  /sendBeacon/i,
  /navigator\s*\./i,
  /https?:\/\//i,
  /\bimport\s*\(/,          // dynamic import (static `import {}` is fine)
  /\brequire\s*\(/,
  /\baxios\b/i,
  /\.ajax\b/i,
  /postMessage/i,
];
const hits = NETWORK_TOKENS.filter((re) => re.test(src)).map((re) => re.source);
assert(hits.length === 0,
  `module references no network API (offending tokens: ${hits.join(", ") || "none"})`);
// Sanity: the scanner CAN detect a token — guards against a vacuous pass.
assert(/\bfetch\s*\(/i.test("x = fetch(url)"),
  "network-token scanner is live (detects a planted token)");
// Determinism/offline corollary: no clock/RNG in the module source either.
assert(!/Date\.now|Math\.random|new Date\s*\(\s*\)/.test(src),
  "module reads no clock and no RNG (deterministic — caller supplies `now`)");

// ── Contract hygiene ─────────────────────────────────────────────────────────
console.log("\n(hygiene) identity, tags, and contract errors");
assert(BOARD_STORAGE_KEY === "serendipity-discoveries-v1",
  "rides the board's own corpus key (no separate storage namespace)");
assert(note.tags.includes(NATIVE_CAPTURE_TAG) && note.tags.includes("surface:agent-worklog"),
  "note is tagged native-capture + surface for a future UI filter");
assert(threw(captureSurpriseThrows),
  "a capture with no `what` is rejected downstream by the S3-1 title requirement");

console.log(`\n✓ native capture connector: ${passed} checks passed.`);
if (process.exitCode) console.error("✗ SOME CHECKS FAILED");

// ── tiny local helpers ───────────────────────────────────────────────────────
function threw(fn) {
  try { fn(); return false; } catch (e) { return e instanceof IngestContractError; }
}
// Building a capture whose distilled `what` is empty must fail at the S3-1
// title check (proving we didn't loosen the contract).
function captureSurpriseThrows() {
  const reg3 = createSurfaceRegistry(["s"]);
  return captureSurprise({ what: "", surface: "s" }, { registry: reg3, now: NOW });
}
