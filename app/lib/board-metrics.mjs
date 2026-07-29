// board-metrics.mjs — S2-4: the funnel + value-weighted density, with the
// "Emitted ≠ counted (yet)" GATE built in.
// ============================================================================
// This module turns the board corpus into the two S1-3 measurables:
//
//   • domain DENSITY  = a ValueScore-WEIGHTED SUM per SKOS domain
//                       (spec-funnel-metric.md §2), and
//   • the capture → triaged → pursued → shipped FUNNEL
//                       (spec-funnel-metric.md §1),
//
// both sliced by `captureMode` (F7), plus a separate **emitter-backlog** volume
// count.
//
// THE GATE (S2-4 / spec-funnel-metric.md §2, rev-3 wording): a pre-`New`
// `emitted` capture is PRE-TRIAGE. It contributes EXACTLY 0 to (a) domain
// density and (b) the funnel `captured` denominator, and appears ONLY in the
// unweighted emitter-backlog volume. This is not a fractional down-weight — it
// falls straight out of the ValueScore-weighted sum because `scoreDiscovery`
// withholds a score until triage (see board-scoring.mjs). 0 = "not scored yet",
// never exclusion: an emitted item is fully alive and promotable, and the moment
// it is triaged (`emitted → New`, binding its facets) it starts contributing its
// ValueScore like any other discovery.
//
// Pure, additive, nullable-safe: legacy discoveries missing the S2-1 facets (or
// any captureMode / domains) are handled without throwing. No stored-field or
// lifecycle changes live here — this is a read-only derivation over the corpus.
// ============================================================================

import {
  scoreDiscovery,
  valueScoreMap,
  PRE_TRIAGE_STATUS,
  isPreTriage,
} from "./board-scoring.mjs";
import { defaultState } from "./steering-loop.mjs";

// Full lifecycle order INCLUDING the S2-4 pre-`New` entry state. `emitted` sits
// BEFORE `new` — the funnel's true mouth. Everything from `new` onward is the
// pre-existing lifecycle, unchanged.
export const LIFECYCLE_ORDER = [
  PRE_TRIAGE_STATUS, // "emitted" — pre-triage entry (S2-4)
  "new",
  "reviewing",
  "team_triage",
  "decision",
  "active",
  "banked",
];

// A discovery is CAPTURED once it has been triaged past `emitted` — i.e. it has
// entered the funnel at `new`. Pre-triage `emitted` items are NOT captured yet
// (that is the whole point of the gate). Legacy items with an unknown/absent
// status are treated as captured (they predate `emitted`, so they are real,
// already-in-funnel discoveries — never accidentally pre-triage).
export const isCaptured = (disc) => disc != null && !isPreTriage(disc);

// Backlog = the raw, UNWEIGHTED count of pre-triage ambient captures. This is
// volume, clearly labeled — it MUST NOT feed value-weighted density.
export const isEmitterBacklog = (disc) => isPreTriage(disc);

const captureModeOf = (disc) =>
  (disc && disc.captureMode) || "unspecified";

// Primary domain name(s) of a discovery. `domains[]` is `[{name, primary}]`;
// the primary is the domain the discovery most lives in (spec-ontology §3). If
// no flag is set we fall back to the first domain. Nullable-safe → [].
export function primaryDomainsOf(disc) {
  const domains = (disc && disc.domains) || [];
  if (!Array.isArray(domains) || domains.length === 0) return [];
  const primaries = domains.filter((d) => d && d.primary).map((d) => d.name);
  if (primaries.length > 0) return primaries.filter(Boolean);
  const first = domains[0] && domains[0].name;
  return first ? [first] : [];
}

/**
 * Value-weighted domain density (spec-funnel-metric.md §2), WITH the gate.
 *
 *   density(d, W) = Σ ValueScore(x)  over captured x with d ∈ x.domains
 *
 * Returns a Map<domainName, number>. A pre-triage `emitted` item has a null
 * ValueScore (board-scoring gate) so it adds nothing — the "Emitted ≠ counted
 * (yet)" guarantee is structural here, not a special case. A window filter can
 * be supplied via `inWindow(disc) → boolean` (PROV-O generatedAtTime); omitted =
 * all time.
 */
export function densityByDomain(items, opts = {}) {
  const state = opts.state || defaultState();
  const inWindow = opts.inWindow || (() => true);
  const scores = valueScoreMap(items, state); // id → ValueScore | null
  const density = new Map();
  for (const disc of items || []) {
    if (!isCaptured(disc)) continue; // gate: emitted excluded from density
    if (!inWindow(disc)) continue;
    const v = disc.id != null ? scores.get(String(disc.id)) : scoreDiscovery(disc, state);
    if (typeof v !== "number") continue; // null = not scored yet → 0 contribution
    for (const dom of primaryDomainsOf(disc)) {
      density.set(dom, (density.get(dom) || 0) + v);
    }
  }
  return density;
}

/** Convenience: density contribution for one domain `d`. */
export function domainDensity(items, d, opts = {}) {
  return densityByDomain(items, opts).get(d) || 0;
}

// Funnel-stage reach from a discovery's CURRENT status (point-in-time proxy for
// the transition history — the board stores current `status`, not a log). An
// item currently at `active` has, by construction, passed through capture and
// triage. `emitted` is rank 0 → has reached NO funnel stage yet.
const stageRank = (disc) => {
  const i = LIFECYCLE_ORDER.indexOf(disc && disc.status);
  return i < 0 ? 1 : i; // unknown/legacy status ⇒ treat as captured (rank of "new")
};
const RANK = {
  new: LIFECYCLE_ORDER.indexOf("new"),
  team_triage: LIFECYCLE_ORDER.indexOf("team_triage"),
  active: LIFECYCLE_ORDER.indexOf("active"),
};

/**
 * The whole S2-4 metric bundle for a corpus, sliced by captureMode.
 *
 * Returns:
 *   {
 *     total,                       // every item, emitted included
 *     emitterBacklog,              // UNWEIGHTED volume of pre-triage captures
 *     funnel: { captured, triaged, pursued, shipped },   // gate-applied counts
 *     density: Map<domain, number>,                      // gate-applied, weighted
 *     byCaptureMode: {                                   // same, per captureMode
 *       [mode]: { emitterBacklog, captured, triaged, pursued, shipped, densityTotal }
 *     },
 *   }
 *
 * Guarantee wired here: `emitterBacklog` never contributes to `density` /
 * `densityTotal` (it is drawn only from pre-triage items, which are gated out of
 * every ValueScore-weighted sum). Captured counts also exclude emitted.
 */
export function funnelMetrics(items, opts = {}) {
  const list = items || [];
  const state = opts.state || defaultState();

  const funnel = { captured: 0, triaged: 0, pursued: 0, shipped: 0 };
  const byCaptureMode = {};
  const modeSlot = (mode) =>
    (byCaptureMode[mode] ||= {
      emitterBacklog: 0,
      captured: 0,
      triaged: 0,
      pursued: 0,
      shipped: 0,
      densityTotal: 0,
    });

  let emitterBacklog = 0;
  const scores = valueScoreMap(list, state);

  for (const disc of list) {
    const mode = captureModeOf(disc);
    const slot = modeSlot(mode);

    if (isEmitterBacklog(disc)) {
      emitterBacklog += 1;
      slot.emitterBacklog += 1;
      continue; // pre-triage: contributes to NO weighted metric, no funnel stage
    }

    const rank = stageRank(disc);
    if (rank >= RANK.new) { funnel.captured += 1; slot.captured += 1; }
    if (rank >= RANK.team_triage) { funnel.triaged += 1; slot.triaged += 1; }
    if (rank >= RANK.active) { funnel.pursued += 1; slot.pursued += 1; }
    // shipped = a pursued item that reached Active with an IMPLEMENT decision
    // (terminal realized hit; Banked is a hold, not a ship — spec §1).
    if (rank >= RANK.active && String(disc.decision).toUpperCase() === "IMPLEMENT") {
      funnel.shipped += 1; slot.shipped += 1;
    }

    const v = disc.id != null ? scores.get(String(disc.id)) : scoreDiscovery(disc, state);
    if (typeof v === "number") slot.densityTotal += v; // weighted; emitted already skipped
  }

  return {
    total: list.length,
    emitterBacklog,
    funnel,
    density: densityByDomain(list, { state }),
    byCaptureMode,
  };
}

/**
 * The triage-promotion patch (S2-4 item 4): `emitted → New`, binding the facet
 * profile AT TRIAGE time (captureMode-aware). Returns the object to merge onto
 * the discovery. Facets the triager set are passed in `facets`; captureMode is
 * PRESERVED from the ambient capture unless explicitly overridden. `triagedDate`
 * stamps the moment the facet profile is bound (the score materializes here).
 * Pure — the caller (board UI) supplies `date` (no clock read in this module).
 */
export function triagePromotionPatch(disc, facets = {}, date) {
  return {
    ...facets,
    status: "new",
    captureMode: facets.captureMode || (disc && disc.captureMode) || "ambient-emitter",
    triagedDate: date || (disc && disc.triagedDate) || null,
  };
}
