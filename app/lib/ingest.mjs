// ingest.mjs — S3-1: the CONNECTOR-AGNOSTIC capture-ingest contract.
// ============================================================================
// This is the SOCKET that capture connectors plug into. It defines ONE code
// path that turns a normalized capture from ANY source into an `emitted` note,
// wired through the SAME S2-4 pre-triage pipeline the board already runs — so
// the "Emitted ≠ counted (yet)" gate (spec-funnel-metric.md §2) holds for
// ingested captures automatically, with no new gate logic here.
//
// WHAT THIS IS
//   • `ingestCapture(payload, { source })` — source-agnostic: accepts a
//     normalized capture and produces a well-formed `emitted` note.
//   • `CaptureSource` — the adapter interface every connector implements
//     (`{ id, normalize(raw) -> payload }`). Any connector is DROP-IN: the
//     Clairvoyance-native connector (S3-2) is implementation #1; Claude.ai /
//     ChatGPT / Slack / notes slot in later with NO core edit here.
//   • `manualSource` — ONE trivial reference source proving the socket. It is
//     NOT a real external connector and reads nothing from the outside world.
//
// WHAT THIS IS NOT (scope guard, S3-1 only)
//   • No specific/real connector. No decision about WHAT external content to
//     read — that is S3-2 (gated). The `source` is just an id + a normalizer.
//   • No lifecycle change beyond S2-4. No fork of the density/funnel pipeline.
//
// PROVENANCE (spec-discovery-ontology.md §5, PROV-O)
//   The emitted note is a `prov:Entity` that `prov:wasGeneratedBy` a
//   `:CaptureActivity`. That activity carries the `captureMode` and the
//   `source` id. Because the entity records its capture activity, triage's
//   existing `prov:wasDerivedFrom` / `prov:wasRevisionOf` link keeps working:
//   the triaged discovery is a revision of THIS captured entity.
//
// PRIVACY / DETERMINISM
//   Source-agnostic and private by default: every capture lands in the local
//   board/`emitted` store via the same path as the in-app ambient emitter.
//   Zero-dep, offline, deterministic — this module reads NO clock and NO RNG;
//   the caller supplies `capturedAt` (the board does the clock read at the UI
//   edge, exactly as `emitAmbient` does). Pure + nullable-safe; never throws
//   on a well-formed adapter, and throws a clear, typed error on a malformed
//   one so connector authors get an actionable message.
// ============================================================================

import { PRE_TRIAGE_STATUS } from "./board-scoring.mjs";

// The captureMode enum (spec §1 F7). Ingested captures default to
// `ambient-emitter` — the cheap/hot pre-triage entry — so they land exactly
// where the in-app emitter's captures do. The GATE, however, keys off
// `status === "emitted"`, NOT captureMode, so it holds for any of these.
export const CAPTURE_MODES = ["deliberate-scan", "ambient-emitter", "manual"];
export const DEFAULT_CAPTURE_MODE = "ambient-emitter";

/**
 * A normalized capture — the source-agnostic payload every adapter emits.
 * @typedef {Object} CapturePayload
 * @property {string}   title         - REQUIRED. The capture note / one-line title.
 * @property {string}   [summary]     - Optional body text.
 * @property {string}   [capturedAt]  - ISO timestamp → prov:generatedAtTime. If
 *                                       absent, `opts.now` is used; document that
 *                                       one of the two must be supplied.
 * @property {string}   [externalId]  - Source-native id (e.g. a message/thread id).
 *                                       Used for a stable note id + prov reference.
 * @property {string[]} [tags]        - Optional free tags carried onto the note.
 */

/**
 * The adapter contract. A connector is nothing more than this: a stable `id`
 * and a pure `normalize(raw) -> CapturePayload`. NO other core change is ever
 * needed to add a source.
 * @typedef {Object} CaptureSource
 * @property {string} id                         - REQUIRED. Stable source id
 *                                                  ("clairvoyance", "manual",
 *                                                  "slack", ...). Becomes note.source.
 * @property {(raw:any) => CapturePayload} normalize - REQUIRED. Maps raw source
 *                                                  data → a CapturePayload.
 * @property {string} [label]                    - Human label for the source.
 * @property {string} [agentLabel]               - prov:wasAttributedTo software-agent
 *                                                  label. Defaults to `label`/`id`.
 */

const isNonEmptyString = (x) => typeof x === "string" && x.trim().length > 0;

class IngestContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "IngestContractError";
  }
}
export { IngestContractError };

/**
 * Validate + freeze an adapter so connectors are DROP-IN and self-describing.
 * Throws IngestContractError with an actionable message if the contract is not
 * met. Returns a frozen CaptureSource. This is the ONLY thing a new connector
 * (S3-2 and beyond) must call — no edit to this module is required to add one.
 * @param {CaptureSource} spec
 * @returns {CaptureSource}
 */
export function defineSource(spec) {
  if (!spec || typeof spec !== "object") {
    throw new IngestContractError("defineSource(spec): spec must be an object.");
  }
  if (!isNonEmptyString(spec.id)) {
    throw new IngestContractError("CaptureSource.id must be a non-empty string.");
  }
  if (typeof spec.normalize !== "function") {
    throw new IngestContractError(
      `CaptureSource "${spec.id}": normalize(raw) must be a function.`
    );
  }
  return Object.freeze({
    id: spec.id,
    normalize: spec.normalize,
    label: spec.label || spec.id,
    agentLabel: spec.agentLabel || spec.label || spec.id,
  });
}

// A deterministic, clock-free, RNG-free note id. Prefer an explicit id, then a
// stable `source:externalId` key (so a source with real native ids dedupes),
// then a slug of the title namespaced by source. No global counter (that would
// couple ingest to board state); the board may re-key on persist if it wants
// its DISC-### scheme — the pipeline only needs a non-null id.
function deriveId(source, payload, opts) {
  if (isNonEmptyString(opts.id)) return opts.id;
  if (isNonEmptyString(payload.externalId)) {
    return `${source.id}:${payload.externalId.trim()}`;
  }
  const slug = String(payload.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${source.id}:${slug || "capture"}`;
}

/**
 * Build the PROV-O provenance block for an ingested capture (spec §5).
 *
 * The note is a `prov:Entity` generated by a `:CaptureActivity` that carries
 * the `captureMode` and the originating `source` id. `generatedAtTime` is the
 * capture timestamp. Triage later attaches `prov:wasRevisionOf` back to this
 * entity, so `wasDerivedFrom` provenance keeps working unchanged.
 */
function buildProvenance({ source, captureMode, capturedAt, payload }) {
  const activity = {
    "@type": ["prov:Activity", ":CaptureActivity"],
    captureMode,
    source: source.id, // the source id the CaptureActivity carries (S3-1)
  };
  if (capturedAt != null) {
    activity.startedAtTime = capturedAt;
    activity.endedAtTime = capturedAt;
  }
  if (isNonEmptyString(payload.externalId)) {
    activity.sourceRef = payload.externalId.trim();
  }
  return {
    "@type": "prov:Entity",
    wasGeneratedBy: activity,
    ...(capturedAt != null ? { generatedAtTime: capturedAt } : {}),
    wasAttributedTo: source.agentLabel || source.id,
  };
}

/**
 * ingestCapture — the source-agnostic core of the contract.
 *
 * Turn a normalized CapturePayload into an `emitted` note that flows through
 * the SAME S2-4 pre-triage pipeline the in-app emitter uses. The returned note:
 *   • has `status: "emitted"` → the gate (board-scoring.isPreTriage) holds, so
 *     it contributes 0 to density and the funnel `captured` denominator until
 *     triaged, appearing only in the unweighted emitter backlog;
 *   • carries `captureMode` (default ambient-emitter), `source`, and a PROV-O
 *     `provenance` block modelling it as a prov:Entity + :CaptureActivity;
 *   • leaves all S2-1 facets UNBOUND (nullable) — they are bound at triage
 *     (triagePromotionPatch), exactly as an in-app ambient capture.
 *
 * @param {CapturePayload} payload  - a normalized capture (from source.normalize)
 * @param {Object} opts
 * @param {CaptureSource} opts.source     - REQUIRED. The originating adapter.
 * @param {string} [opts.now]             - ISO fallback capture time when the
 *                                          payload omits `capturedAt`.
 * @param {string} [opts.captureMode]     - override (must be in CAPTURE_MODES).
 * @param {string} [opts.id]              - override the derived note id.
 * @returns {Object} an `emitted` note ready to persist onto the board corpus.
 */
export function ingestCapture(payload, opts = {}) {
  const source = opts.source;
  if (!source || !isNonEmptyString(source.id) || typeof source.normalize !== "function") {
    throw new IngestContractError(
      "ingestCapture requires opts.source to be a valid CaptureSource (id + normalize). " +
        "Build one with defineSource()."
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new IngestContractError(
      `Source "${source.id}" produced a non-object payload. normalize(raw) must return a CapturePayload.`
    );
  }
  if (!isNonEmptyString(payload.title)) {
    throw new IngestContractError(
      `Source "${source.id}" produced a capture with no title. CapturePayload.title is required.`
    );
  }

  const captureMode = opts.captureMode || DEFAULT_CAPTURE_MODE;
  if (!CAPTURE_MODES.includes(captureMode)) {
    throw new IngestContractError(
      `Unknown captureMode "${captureMode}". Must be one of: ${CAPTURE_MODES.join(", ")}.`
    );
  }

  // Timestamp resolution — NO clock read here (determinism). Prefer the
  // payload's own capturedAt, else the caller-supplied opts.now, else null
  // (nullable-safe; the board supplies the clock at the UI edge).
  const capturedAt = isNonEmptyString(payload.capturedAt)
    ? payload.capturedAt
    : isNonEmptyString(opts.now)
    ? opts.now
    : null;

  const title = payload.title.trim();

  return {
    id: deriveId(source, payload, opts),
    title,
    // ── S2-4 pre-triage entry: the gate keys off this status ──────────────
    status: PRE_TRIAGE_STATUS, // "emitted"
    captureMode,
    // ── source-agnostic marker: just a field, identical across all sources ─
    source: source.id,
    // ── PROV-O (spec §5): entity generated by a :CaptureActivity ──────────
    provenance: buildProvenance({ source, captureMode, capturedAt, payload }),
    // prov:generatedAtTime — the board maps discoveredDate → prov:generatedAtTime
    discoveredDate: capturedAt,
    sourceAgent: source.agentLabel || source.id, // prov:wasAttributedTo (SoftwareAgent)
    discoveredBy: "Ingest",
    summary: isNonEmptyString(payload.summary) ? payload.summary : "",
    // ── facets UNBOUND (nullable) — bound at triage, exactly like emitAmbient ─
    owner: "",
    teamVisible: true,
    convergence: false,
    refinementNotes: "",
    decision: "",
    decisionReason: "",
    nextAction: "",
    nextActionDate: "",
    reactivationTrigger: "",
    relatedIds: [],
    tags: Array.isArray(payload.tags) ? payload.tags.filter(isNonEmptyString) : [],
    domains: [],
    relations: [],
  };
}

/**
 * ingestFrom — the full DROP-IN path in one call: normalize raw source data
 * through the adapter, then ingest it. This is what a connector's runtime calls
 * per captured item. `source.normalize` is the ONLY source-specific code; the
 * rest of the path is identical for every connector.
 *
 * @param {CaptureSource} source
 * @param {any} raw                - raw source-native data
 * @param {Object} [opts]          - forwarded to ingestCapture (now/captureMode/id)
 * @returns {Object} an `emitted` note
 */
export function ingestFrom(source, raw, opts = {}) {
  if (!source || typeof source.normalize !== "function") {
    throw new IngestContractError(
      "ingestFrom(source, raw): source must be a CaptureSource built with defineSource()."
    );
  }
  const payload = source.normalize(raw);
  return ingestCapture(payload, { ...opts, source });
}

// ─── Reference source (proves the socket; NOT a real connector) ──────────────
// The trivial `manual` source. `raw` is either a plain string or
// `{ title, summary?, capturedAt?, externalId?, tags? }`. It reads nothing
// external — it just shows an adapter is ~5 lines and needs no core edit.
export const manualSource = defineSource({
  id: "manual",
  label: "Manual capture",
  agentLabel: "Manual",
  normalize(raw) {
    if (typeof raw === "string") return { title: raw };
    const r = raw || {};
    return {
      title: r.title,
      summary: r.summary,
      capturedAt: r.capturedAt,
      externalId: r.externalId,
      tags: r.tags,
    };
  },
});
