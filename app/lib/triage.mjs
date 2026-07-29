// triage.mjs — S3-3: TWO-TIER TRIAGE (cheap auto-facets → fast human confirm).
// ============================================================================
// S2-4 gave us the gate ("Emitted ≠ counted (yet)"): an `emitted` ambient
// capture withholds its ValueScore until triage binds its facet profile. S3-1
// gave us a source-agnostic flood of such `emitted` notes. The risk that pairs
// with cheap ambient capture is a TRIAGE BOTTLENECK — if promoting each capture
// takes real analytic effort, the backlog floods and the gate just hides an
// ever-growing pile. S3-3 keeps BOTH sides cheap:
//
//   • TIER 1 — `autoFacets(note, corpus?)`: a cheap, OFFLINE pre-compute that
//     PROPOSES a provisional facet profile the instant a note is emitted — an
//     embedding distance-band (via semantic-convergence's local fallback) plus
//     conservative provisional surprise/impact heuristics. It is a SUGGESTION,
//     never a commitment: it does not mutate the note, does not set a status,
//     and is flagged `provisional: true` so a guess can never be mistaken for a
//     human-confirmed fact. It stays gated (score still null) until Tier 2.
//
//   • TIER 2 — `confirmTriage(note, confirmedFacets, opts)`: ONE fast human
//     action. It takes the facets a human confirmed (typically the Tier-1
//     suggestion, edited or accepted), sanitizes away all provisional meta, and
//     promotes `emitted → New` by DELEGATING to board-metrics
//     `triagePromotionPatch`. That is the single existing promotion path that
//     binds facets at triage time — so the ValueScore materializes HERE, per the
//     S2-4 gate, and the item begins contributing to density / funnel exactly
//     like any other discovery.
//
// WHAT THIS IS NOT (scope guard, S3-3 only)
//   • DOWNSTREAM triage SCORING mechanics over already-`emitted` notes. It makes
//     NO decision about what content is captured, from where, or how it is
//     stored / kept private — that is S3-2 (a separate, gated design).
//   • No new promotion path, no fork of density/funnel, no lifecycle change. The
//     promotion is board-metrics `triagePromotionPatch`, reused verbatim.
//
// CONSTRAINTS: additive, back-compat, nullable-safe. Zero-dep, OFFLINE,
// DETERMINISTIC — the local hash-embedding fallback only (no network / keys /
// installs) and NO clock reads (the caller supplies `opts.date`, exactly as the
// board does at the UI edge). Reuses semantic-convergence + board-metrics; no
// duplication of their logic.
// ============================================================================

import {
  LocalHashEmbeddingProvider,
  cosineDistance,
  classifyBand,
  ideaDistance as ideaDistanceGeom,
  primaryDomain,
  BANDS,
  DEFAULTS,
} from "./semantic-convergence.mjs";
import { triagePromotionPatch } from "./board-metrics.mjs";
import { isPreTriage } from "./board-scoring.mjs";

// The marker that stamps a Tier-1 output as a GUESS. Any facet set carrying this
// is provisional and MUST pass through `confirmTriage` (which strips it) before
// it can bind onto a note. This is the one field that keeps provisional and
// confirmed distinguishable end-to-end.
export const PROVISIONAL_FLAG = "provisional";

// The board field a Tier-1 suggestion is parked under on an `emitted` note. It
// lives OUTSIDE the real facet fields (surprise/impact/distanceBand/…), so a
// provisional guess is never read as a bound facet and the S2-4 gate is
// untouched — the note is still `emitted`, still scores null.
export const SUGGESTION_FIELD = "triageSuggestion";

// Facet keys the board actually scores on (board-scoring.toValueProfile) plus
// the promotion-relevant fields. Tier 2 whitelists ONLY these off a confirmed
// facet set, so provisional meta (provisional / distanceSource / rationale …)
// can never leak onto a triaged note.
export const CONFIRMABLE_FACET_KEYS = Object.freeze([
  "type",
  "surprise",
  "impact",
  "generality",
  "serendipityPotential",
  "distanceBand",
  "domainDistance",
  "captureMode",
  "domains",
]);

// ── Conservative provisional heuristics (Tier 1) ─────────────────────────────
// These are deliberately LOW and honest: a cheap geometric pre-compute cannot
// know felt surprise or downstream impact, so it must not fabricate a high
// score that would let a machine guess masquerade as signal. surprise is 1..5,
// impact is 1..10 (matching steering-loop's g_surp / g_imp scales).
//
// surprise: mid-low, nudged by the distance band — a mid-distance (serendipity)
// pair is the only region where "unexpected" is even plausible cheaply; near
// (restatement) and far (likely noise) both stay lower. Never above the middle.
const PROVISIONAL_SURPRISE_BY_BAND = Object.freeze({
  [BANDS.TOO_CLOSE]: 2,
  [BANDS.SERENDIPITY]: 3,
  [BANDS.TOO_FAR]: 2,
});
// impact: a flat conservative default. Impact is not cheaply inferable from
// geometry at all, so Tier 1 refuses to guess high — it parks a low-mid
// placeholder (3/10) that the human is expected to overwrite at confirm time.
const PROVISIONAL_IMPACT = 3;

const isNonEmptyString = (x) => typeof x === "string" && x.trim().length > 0;

// Text a note contributes to the local embedding: title + summary + tags. Cheap
// bag-of-words; the deterministic hash provider turns it into a stable vector.
function noteText(note) {
  const bits = [];
  if (note && isNonEmptyString(note.title)) bits.push(note.title);
  if (note && isNonEmptyString(note.summary)) bits.push(note.summary);
  if (note && Array.isArray(note.tags)) bits.push(note.tags.join(" "));
  return bits.join(" ").trim();
}

/**
 * TIER 1 — cheap, offline, PROVISIONAL auto-facets for an `emitted` note.
 *
 * Cheaply pre-computes a suggested facet profile WITHOUT committing anything:
 *   • distanceBand + a numeric idea-distance (domainDistance, 0..1). Preference:
 *       1. a real IDEA-distance if the note's title/poles are separable
 *          (semantic-convergence.ideaDistance — "source → target" style notes);
 *       2. else a NOVELTY distance vs the corpus: the nearest-neighbour cosine
 *          distance from this note to any OTHER note (how close is this to
 *          something we already hold — near ⇒ restatement, far ⇒ unrelated);
 *       3. else a neutral band-center default (no evidence either way).
 *   • provisional surprise (1..5) and impact (1..10) — conservative heuristics,
 *     clearly placeholders (see PROVISIONAL_SURPRISE_BY_BAND / PROVISIONAL_IMPACT).
 *
 * Returns a SUGGESTION object flagged `provisional: true`. It never mutates the
 * note and never sets a status — the note stays `emitted` and stays gated (its
 * ValueScore is still null) until a human confirms via `confirmTriage`.
 *
 * @param {Object} note              an `emitted` note (ingest.mjs shape)
 * @param {Object[]} [corpus]        other notes/discoveries, for novelty distance
 * @param {Object} [opts]
 * @param {Object} [opts.provider]   EmbeddingProvider (default: local fallback)
 * @param {number} [opts.tauLo]      band thresholds (default DEFAULTS.TAU_LO/HI)
 * @param {number} [opts.tauHi]
 * @returns {Object} provisional facet suggestion
 */
export function autoFacets(note, corpus = [], opts = {}) {
  const provider = opts.provider || new LocalHashEmbeddingProvider();
  const bandOpts = {
    tauLo: opts.tauLo ?? DEFAULTS.TAU_LO,
    tauHi: opts.tauHi ?? DEFAULTS.TAU_HI,
  };

  let distance = null;
  let distanceSource = "default";

  // (1) Real idea-distance when the note's two poles are separable.
  const idea = note ? ideaDistanceGeom(note, provider, bandOpts) : null;
  if (idea && Number.isFinite(idea.distance)) {
    distance = idea.distance;
    distanceSource = "idea";
  }

  // (2) Novelty distance vs the corpus: nearest-neighbour cosine distance to any
  // OTHER note. Cheap "is this a near-duplicate of what we already hold?" signal.
  if (distance == null && Array.isArray(corpus) && corpus.length) {
    const self = note ? provider.embed(noteText(note)) : null;
    const selfId = note && note.id != null ? String(note.id) : null;
    let nearest = null;
    for (const other of corpus) {
      if (!other) continue;
      if (selfId != null && other.id != null && String(other.id) === selfId) continue;
      const text = noteText(other);
      if (!text) continue;
      const d = cosineDistance(self, provider.embed(text));
      if (nearest == null || d < nearest) nearest = d;
    }
    if (nearest != null && Number.isFinite(nearest)) {
      distance = nearest;
      distanceSource = "corpus-novelty";
    }
  }

  // (3) Neutral default: band center — genuinely no evidence either way.
  if (distance == null) {
    distance = DEFAULTS.C;
    distanceSource = "default";
  }

  const distanceBand = classifyBand(distance, bandOpts);
  const surprise = PROVISIONAL_SURPRISE_BY_BAND[distanceBand] ?? 2;
  const impact = PROVISIONAL_IMPACT;

  return {
    // ── the provisional facet suggestions (board-schema field names) ─────────
    distanceBand,
    domainDistance: distance, // numeric idea-distance (0..1) → d_idea at scoring
    surprise, // 1..5  — PROVISIONAL placeholder
    impact, // 1..10 — PROVISIONAL placeholder
    // ── provenance of the guess (NOT facet fields; stripped at confirm) ──────
    [PROVISIONAL_FLAG]: true,
    distanceSource, // "idea" | "corpus-novelty" | "default"
    primaryDomain: note ? primaryDomain(note) : null,
    rationale: {
      distance:
        distanceSource === "idea"
          ? "idea-distance between the note's separable poles"
          : distanceSource === "corpus-novelty"
          ? "nearest-neighbour cosine distance vs the corpus (novelty)"
          : "no poles and no corpus — neutral band-center default",
      surprise: `provisional, from distance band "${distanceBand}" (conservative, human overrides)`,
      impact: `provisional placeholder ${PROVISIONAL_IMPACT}/10 — not cheaply inferable, human sets it`,
    },
  };
}

/**
 * TRUE iff `x` is a provisional (Tier-1) facet set. The single predicate that
 * keeps a machine guess from being read as a confirmed fact.
 */
export function isProvisional(x) {
  return !!(x && typeof x === "object" && x[PROVISIONAL_FLAG] === true);
}

/**
 * Attach a Tier-1 suggestion to an `emitted` note WITHOUT promoting it — for the
 * board to surface a one-click confirm. The suggestion is parked under
 * `SUGGESTION_FIELD`, OUTSIDE the real facet fields, so the note stays `emitted`
 * and stays gated (score still null). Returns a NEW note object (non-mutating).
 * A non-emitted note is returned unchanged (nothing to suggest against).
 */
export function attachSuggestion(note, corpus = [], opts = {}) {
  if (!note || !isPreTriage(note)) return note;
  return { ...note, [SUGGESTION_FIELD]: autoFacets(note, corpus, opts) };
}

/**
 * Keep only the real, scoreable facet fields off a confirmed facet set, dropping
 * every provisional-meta key (provisional / distanceSource / rationale /
 * primaryDomain / the parked suggestion field). This is what guarantees a
 * provisional guess can never bind onto a triaged note verbatim — the human's
 * confirmed values pass, the guess's bookkeeping does not.
 */
export function sanitizeConfirmedFacets(confirmedFacets = {}) {
  const out = {};
  for (const k of CONFIRMABLE_FACET_KEYS) {
    if (confirmedFacets[k] !== undefined) out[k] = confirmedFacets[k];
  }
  return out;
}

/**
 * TIER 2 — the ONE fast human-confirm action. Apply the human-confirmed facets
 * and promote `emitted → New`.
 *
 * The confirmed facets (typically a Tier-1 suggestion the human accepted or
 * edited) are sanitized to the scoreable facet whitelist — so no `provisional`
 * marker or guess-bookkeeping survives — and the promotion itself DELEGATES to
 * board-metrics `triagePromotionPatch`, the existing single path that binds
 * facets at triage time. Because the promoted note's `status` becomes `new`, the
 * S2-4 gate opens: its ValueScore materializes and it starts contributing to
 * density / funnel like any other discovery.
 *
 * @param {Object} note             the `emitted` note being triaged
 * @param {Object} confirmedFacets  human-confirmed facet values
 * @param {Object} [opts]
 * @param {string} [opts.date]      triagedDate stamp (caller supplies the clock)
 * @param {boolean} [opts.allowRetriage]  triage a non-emitted note anyway (default false)
 * @returns {Object} the promoted note (status "new", facets bound, suggestion dropped)
 */
export function confirmTriage(note, confirmedFacets = {}, opts = {}) {
  if (!note || typeof note !== "object") {
    throw new TypeError("confirmTriage(note, …): note must be an object.");
  }
  if (!isPreTriage(note) && !opts.allowRetriage) {
    throw new Error(
      `confirmTriage: note "${note.id ?? "?"}" is not pre-triage (status="${note.status}"). ` +
        "Only `emitted` notes are triaged; pass opts.allowRetriage to override."
    );
  }

  const facets = sanitizeConfirmedFacets(confirmedFacets);
  // Delegate the emitted→New promotion + facet binding to the SINGLE existing
  // path (board-metrics). No new promotion logic here.
  const patch = triagePromotionPatch(note, facets, opts.date);

  // Merge the patch and DROP the parked provisional suggestion — a confirmed,
  // scored note carries no leftover guess.
  const promoted = { ...note, ...patch };
  delete promoted[SUGGESTION_FIELD];
  return promoted;
}

/** TRUE once a note has been triaged out of the pre-triage `emitted` state. */
export function isTriaged(note) {
  return !!note && note.status !== undefined && !isPreTriage(note);
}
