// native-capture.mjs — S3-2: the Clairvoyance-native capture connector.
// ============================================================================
// Implementation #1 of the S3-1 `CaptureSource` / `defineSource` contract
// (ingest.mjs). A Staff member or agent, as a BYPRODUCT of doing its work,
// notices a genuine surprise and emits a DISTILLED capture; that capture flows
// through the SAME S3-1 `ingestCapture` path into the local board store as a
// pre-triage `emitted` note. No new lifecycle, no new gate — it rides the
// socket S3-1 already built.
//
// THIS IS PRIVACY-CRITICAL. The following constraints are RATIFIED and enforced
// in code here (and proven by native-capture.smoke.mjs):
//
//   1. USER-LOCAL, user-owned, per-install. The connector performs ZERO remote
//      I/O — no server calls, no telemetry, no phone-home. Captures go ONLY to
//      the local board store via S3-1 `ingestCapture`. (Structural: this module
//      references no remote-I/O API whatsoever — proven by a source scan.)
//   2. DISTILLED-ONLY. The stored note carries a distilled surprise — what /
//      where / why — plus minimal provenance, and NEVER raw conversation
//      content. `distill()` reads ONLY the distilled fields off its input; any
//      raw transcript / message body / unknown field is structurally dropped,
//      never copied onto the note.
//   3. LOCAL ADAPTER ONLY. Persistence rides the board's OWN local storage
//      adapter (the `window.storage` / localStorage shape: async get/set on a
//      JSON-array corpus). This module adds NO storage layer of its own — it
//      reads and rewrites the board's existing corpus through the injected
//      adapter.
//   4. NEVER AUTO-PUBLIC. A capture is PRIVATE board state. This connector sets
//      NO public flag, ever, and marks native captures `teamVisible: false`
//      (private-to-user) — overriding S3-1's inherited `teamVisible: true`
//      default, since team capture-sharing is deferred (see below). A capture
//      becomes public ONLY if the user LATER explicitly promotes a discovery via
//      the existing separate artifact-promotion flow — untouched here.
//   5. OPT-IN PER SURFACE. A per-surface enable registry, DEFAULT OFF. A capture
//      fires ONLY for surfaces the user has explicitly opted in. enable/disable
//      provided.
//   6. VIEW + PURGE ANYTIME. `listNativeCaptures(store)` returns the native
//      capture log; `purgeNativeCaptures(store)` deletes them from the local
//      store. Both operate only on native-source notes and leave everything else
//      in the corpus untouched.
//
//   DEFERRED — NOT BUILT HERE (constraint 7): group/team capture-sharing. Out of
//   scope for S3-2; a native capture is private-to-user board state only.
//
//   DEFERRED — board-UI surfacing (a capture-log view + purge button + per-
//   surface opt-in toggle in discovery-board.jsx) is a thin follow-up the SM
//   runs AFTER S3-5 lands. NOT built here (would collide with the in-flight
//   S3-5 board edit). This module exposes the APIs that wiring will call.
//
//   FOLLOW-UP (out of S3-2 scope): S3-1's `ingestCapture` hardcodes
//   `teamVisible: true` for all ingested captures. That default should later be
//   reconsidered toward private-by-default at the contract level; for now we
//   override per-note here.
//
// Zero-dep, offline, deterministic: this module reads NO clock and NO RNG. The
// caller supplies `now` at the UI edge (exactly as the S3-1 contract does).
// ============================================================================

import { defineSource, ingestFrom } from "./ingest.mjs";

const isNonEmptyString = (x) => typeof x === "string" && x.trim().length > 0;

// ─── Identity ────────────────────────────────────────────────────────────────
// The stable source id (spec S3-2). Every native capture's `note.source` equals
// this — it is the canonical way to identify a native capture in the corpus.
export const NATIVE_SOURCE_ID = "clairvoyance-native";
// A redundant human-visible marker tag carried on the note (does not gate
// identity — `note.source` is canonical — but helps a future UI filter/label).
export const NATIVE_CAPTURE_TAG = "native-capture";
// The board's OWN corpus key (discovery-board.jsx `STORAGE_KEY`). We ride the
// board's local adapter under this key rather than inventing storage. The
// deferred board-UI wiring may pass an explicit key; this is the default.
export const BOARD_STORAGE_KEY = "serendipity-discoveries-v1";

/**
 * DISTILL a native surprise into an S3-1 CapturePayload — the privacy core.
 *
 * This is the source's `normalize(raw)`. It reads ONLY the distilled fields the
 * emitter supplies — `what` (the surprise, one line), `where` (the locus/
 * surface), `why` (why it is surprising) — plus optional minimal provenance
 * (`surface`, `capturedAt`, `externalId`, distilled `tags`). It NEVER reads a
 * raw transcript / message body / conversation object: any such field on `raw`
 * is structurally ignored and thus can never reach the stored note. The
 * connector cannot police the SEMANTIC content a caller stuffs into `what`/
 * `why` — that discipline is the capture-directive doc's job — but STRUCTURALLY,
 * only distilled fields ever cross this boundary.
 *
 * @param {{what:string, where?:string, why?:string, surface?:string,
 *          capturedAt?:string, externalId?:string, tags?:string[]}} raw
 * @returns {{title:string, summary:string, capturedAt?:string,
 *            externalId?:string, tags:string[]}}
 */
export function distill(raw) {
  const r = raw || {};
  // `what` is the surprise headline → becomes the note title (S3-1 requires it).
  const what = isNonEmptyString(r.what) ? r.what.trim() : "";
  const where = isNonEmptyString(r.where) ? r.where.trim() : "";
  const why = isNonEmptyString(r.why) ? r.why.trim() : "";
  const surface = isNonEmptyString(r.surface) ? r.surface.trim() : "";

  // Distilled body: a compact where/why line. These are the emitter's own
  // distilled phrasings, NOT copied raw content.
  const parts = [];
  if (where) parts.push(`Where: ${where}`);
  if (why) parts.push(`Why it surprised: ${why}`);
  const summary = parts.join(" · ");

  // Tags: the native marker, the surface (so the log is filterable), and any
  // distilled free tags the emitter passed. Nothing raw.
  const tags = [NATIVE_CAPTURE_TAG];
  if (surface) tags.push(`surface:${surface}`);
  if (Array.isArray(r.tags)) for (const t of r.tags) if (isNonEmptyString(t)) tags.push(t.trim());

  return {
    title: what,
    summary,
    ...(isNonEmptyString(r.capturedAt) ? { capturedAt: r.capturedAt } : {}),
    ...(isNonEmptyString(r.externalId) ? { externalId: r.externalId } : {}),
    tags,
  };
}

// The S3-2 CaptureSource — a DROP-IN adapter, defined against the S3-1 contract
// with zero edits to ingest.mjs. `normalize` is the distiller above.
export const nativeSource = defineSource({
  id: NATIVE_SOURCE_ID,
  label: "Clairvoyance (native)",
  agentLabel: "Clairvoyance",
  normalize: distill,
});

/** Canonical identity check: is this corpus note a native capture? */
export const isNativeCapture = (note) =>
  note != null && note.source === NATIVE_SOURCE_ID;

// ─── Constraint 5: per-surface OPT-IN registry (default OFF) ──────────────────
/**
 * A tiny enable registry. Nothing is enabled until the user opts a surface in;
 * `isEnabled` is false for any surface not explicitly enabled. Injectable so
 * tests (and isolated call sites) never leak global state.
 */
export function createSurfaceRegistry(initial = []) {
  const on = new Set();
  for (const s of initial) if (isNonEmptyString(s)) on.add(s.trim());
  return {
    enable(surface) { if (isNonEmptyString(surface)) on.add(surface.trim()); return this; },
    disable(surface) { if (isNonEmptyString(surface)) on.delete(surface.trim()); return this; },
    isEnabled(surface) { return isNonEmptyString(surface) && on.has(surface.trim()); },
    enabled() { return [...on]; },
    clear() { on.clear(); return this; },
  };
}

// The process-wide default registry. DEFAULT OFF — empty until the user opts in.
export const defaultRegistry = createSurfaceRegistry();
export const enableSurface = (surface) => defaultRegistry.enable(surface);
export const disableSurface = (surface) => defaultRegistry.disable(surface);
export const isSurfaceEnabled = (surface) => defaultRegistry.isEnabled(surface);
export const enabledSurfaces = () => defaultRegistry.enabled();

/**
 * Apply the S3-2 privacy overrides to an S3-1 emitted note. Additive: takes the
 * plain object `ingestCapture` returned and returns a copy with native-capture
 * privacy invariants pinned. Sets NO public flag (constraint 4) and forces
 * `teamVisible: false` (private-to-user; overrides S3-1's inherited `true`).
 */
function applyPrivacyOverrides(note) {
  return { ...note, teamVisible: false };
}

// ─── Constraint 2/4/5: build a distilled, private, gated capture note ────────
/**
 * captureSurprise — the emitter's entry point. PURE and clock-free: it gates on
 * the opt-in registry and, if the surface is enabled, DISTILLS the input into a
 * private `emitted` note via the S3-1 path. Returns the note, or `null` when the
 * surface is not opted in (a genuine no-op — nothing is built, nothing stored).
 *
 * It does NOT persist by itself — persistence is a separate, explicit step
 * (`recordCapture` / the deferred board wiring) so this stays a pure builder.
 *
 * @param {{what:string, where?:string, why?:string, surface:string,
 *          capturedAt?:string, externalId?:string, tags?:string[]}} input
 * @param {{registry?:object, now?:string, id?:string}} [opts]
 * @returns {object|null} the private `emitted` note, or null if not opted-in
 */
export function captureSurprise(input, opts = {}) {
  const registry = opts.registry || defaultRegistry;
  const surface = input && input.surface;
  // Constraint 5: fire ONLY for an opted-in surface. Otherwise no-op.
  if (!registry.isEnabled(surface)) return null;
  // Build the emitted note through the S3-1 socket, then pin privacy invariants.
  const note = ingestFrom(nativeSource, input, { now: opts.now, id: opts.id });
  return applyPrivacyOverrides(note);
}

// ─── Constraint 3: ride the board's local adapter (no new storage) ───────────
// The board's adapter is the async `window.storage` shape: `get(key) ->
// { value:<json> }` and `set(key, <json>)`, over a JSON-array corpus. These
// helpers read/rewrite THAT corpus; they invent no persistence of their own.
async function readCorpus(store, key) {
  if (!store || typeof store.get !== "function" || typeof store.set !== "function") {
    throw new TypeError(
      "native-capture: store must be the board's local adapter { get(key), set(key,value) }."
    );
  }
  const r = await store.get(key);
  if (!r || !isNonEmptyString(r.value)) return [];
  const parsed = JSON.parse(r.value);
  return Array.isArray(parsed) ? parsed : [];
}
async function writeCorpus(store, key, arr) {
  await store.set(key, JSON.stringify(arr));
}

/**
 * recordCapture — the full local-only path in one call for the deferred board
 * wiring: gate + distill + persist onto the board's existing corpus via its own
 * adapter. Prepends (newest-first, matching the board's addItem). Returns the
 * stored note, or null if the surface was not opted-in (nothing written).
 *
 * @param {object} store   - the board's local adapter { get, set }
 * @param {object} input   - see captureSurprise
 * @param {{registry?:object, now?:string, id?:string, key?:string}} [opts]
 * @returns {Promise<object|null>}
 */
export async function recordCapture(store, input, opts = {}) {
  const note = captureSurprise(input, opts);
  if (note == null) return null; // not opted-in → no-op, nothing persisted
  const key = opts.key || BOARD_STORAGE_KEY;
  const corpus = await readCorpus(store, key);
  await writeCorpus(store, key, [note, ...corpus]);
  return note;
}

// ─── Constraint 6: VIEW + PURGE the native capture log ───────────────────────
/**
 * listNativeCaptures — the user's view of their native capture log. Reads the
 * board corpus through the local adapter and returns ONLY native-source notes,
 * newest-first as stored. Non-native discoveries are never returned.
 *
 * @param {object} store
 * @param {{key?:string}} [opts]
 * @returns {Promise<object[]>}
 */
export async function listNativeCaptures(store, opts = {}) {
  const key = opts.key || BOARD_STORAGE_KEY;
  const corpus = await readCorpus(store, key);
  return corpus.filter(isNativeCapture);
}

/**
 * purgeNativeCaptures — delete native captures from the local store. Rewrites
 * the corpus keeping every NON-native note untouched and dropping every native
 * one. Returns what was removed and what remains, so a UI can confirm.
 *
 * @param {object} store
 * @param {{key?:string}} [opts]
 * @returns {Promise<{removedCount:number, removed:object[], remaining:number}>}
 */
export async function purgeNativeCaptures(store, opts = {}) {
  const key = opts.key || BOARD_STORAGE_KEY;
  const corpus = await readCorpus(store, key);
  const removed = corpus.filter(isNativeCapture);
  const remaining = corpus.filter((n) => !isNativeCapture(n));
  await writeCorpus(store, key, remaining);
  return { removedCount: removed.length, removed, remaining: remaining.length };
}
