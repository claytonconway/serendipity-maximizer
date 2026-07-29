// reflex-metrics.mjs — S3-4: the "reflex vs ritual" measurement.
// ============================================================================
// Sprint 3 pivoted on ONE hypothesis: capture-as-a-REFLEX (ambient, cheap, hot —
// the S1-4 emitter / S3-1 ingest path) yields more real serendipity than the
// deliberate capture RITUAL (a scheduled/manual scan). This module is the
// INSTRUMENT that tests that hypothesis. It does NOT decide capture sources,
// content, or privacy (that is S3-2) — it is pure measurement/analytics over the
// discoveries a corpus already holds.
//
// WHAT IT DOES
//   Partition the corpus by capture STYLE, then run the SAME three outcome
//   measures over each cohort and hand back a head-to-head comparison:
//
//     • ambient    = captureMode === "ambient-emitter"            (the reflex)
//     • deliberate = captureMode ∈ {deliberate-scan, manual},     (the ritual)
//                    AND missing/legacy captureMode (a legacy discovery predates
//                    the ambient emitter, so it can only have been a deliberate
//                    capture — never accidentally counted as reflex).
//
//   Per cohort:
//     1. promotionRate      — capture→hit rate (spec-funnel-metric.md §1.1):
//                             # reaching Active ("pursued") / # captured.
//     2. convergenceRate    — share of the cohort landing in a geometric
//                             :Convergence (semantic-convergence.detectConvergences).
//     3. bridgeRate         — share of the cohort whose primary domain sits on a
//                             cross-domain serendipity-band bridge.
//
//   delta = ambient − deliberate for each rate. A POSITIVE delta is evidence FOR
//   the reflex; a negative delta is evidence FOR the ritual. This module only
//   measures — it does not adjudicate the pivot.
//
// REUSE, NOT REIMPLEMENTATION (S3-4 constraint)
//   • funnelMetrics (board-metrics.mjs) already slices captured/pursued by
//     captureMode with the S2-4 gate applied — we AGGREGATE its byCaptureMode
//     slots into the two cohorts; we do not recount the funnel here.
//   • detectConvergences / analyzeDiscoveries (semantic-convergence.mjs) own the
//     geometric :Convergence and the domain-distance bands — we consume their
//     output; we do not re-derive any geometry here.
//   • primaryDomain (semantic-convergence.mjs) is the single shape-tolerant
//     domain accessor, reused so cohort/bridge domains match the engine exactly.
//
// captureMode-AGNOSTIC to S3-2: this reads `captureMode` as an opaque label off
// each discovery. It makes NO assumption about where ambient captures come from
// or what they contain — S3-2 owns that. Swap the connector, the measurement is
// unchanged.
//
// CROSS-PROJECT SEAM (the "one store" vision)
//   A TRUE cross-project bridge — the headline serendipity event, an insight in
//   project A firing a discovery in project B — needs a MULTI-PROJECT corpus that
//   does not exist yet (all discoveries here belong to one board/project). So for
//   now `bridgeRate` measures cross-DOMAIN bridges WITHIN the given corpus. The
//   seam for later is explicit: `opts.projectOf(disc)` is threaded through and, on
//   the day the single store spans projects, the bridge predicate can additionally
//   require the two endpoints to be in DISTINCT projects (see `bridgeDomainsOf`).
//   Nothing else in the comparison shape changes.
//
// Pure ESM, zero-dep, offline, deterministic, nullable-safe. Additive: no
// existing module is edited.
// ============================================================================

import { funnelMetrics } from "./board-metrics.mjs";
import {
  analyzeDiscoveries,
  primaryDomain,
  BANDS,
} from "./semantic-convergence.mjs";

// The one capture style that counts as the "reflex". Everything else — including
// missing/legacy captureMode — is the "ritual" (see header rationale).
export const AMBIENT_MODE = "ambient-emitter";

/** Cohort of a single discovery: "ambient" (reflex) vs "deliberate" (ritual). */
export function cohortOf(disc) {
  const mode = disc && disc.captureMode;
  return mode === AMBIENT_MODE ? "ambient" : "deliberate";
}

// The bands that qualify a cross-domain pair as a real "bridge". By default only
// the SERENDIPITY band: a too-close pair is a cliché restatement (redundancy,
// not a bridge) and a too-far pair is noise (unrelated, not a bridge). The
// productive bridge is exactly the serendipity band — the whole point of the
// distance metric (spec-distance-band.md). Tunable via opts.bridgeBands.
const DEFAULT_BRIDGE_BANDS = Object.freeze([BANDS.SERENDIPITY]);

const safeRate = (num, den) => (den > 0 ? num / den : 0);

/**
 * Aggregate funnelMetrics' per-captureMode slots into the two cohorts. Reuses the
 * gate-applied counts (captured/pursued already exclude pre-triage `emitted`).
 * cohort `n` (total captures of that style) = captured + emitterBacklog, since
 * every item is either pre-triage backlog or a captured (New+) discovery.
 */
function cohortFunnel(byCaptureMode) {
  const blank = () => ({ emitterBacklog: 0, captured: 0, triaged: 0, pursued: 0, shipped: 0 });
  const out = { ambient: blank(), deliberate: blank() };
  for (const [mode, slot] of Object.entries(byCaptureMode || {})) {
    const cohort = mode === AMBIENT_MODE ? "ambient" : "deliberate";
    const dst = out[cohort];
    for (const k of Object.keys(dst)) dst[k] += slot[k] || 0;
  }
  return out;
}

/**
 * The set of domains that sit on a cross-domain bridge — i.e. domains that are an
 * endpoint of at least one distinct-domain pair whose domain-distance falls in a
 * qualifying (serendipity) band. Built from analyzeDiscoveries().domainPairs, so
 * the geometry is the engine's, not ours.
 *
 * CROSS-PROJECT SEAM: when the corpus one day spans projects, add a
 * `projectOf(a) !== projectOf(b)` guard here to promote this from cross-DOMAIN to
 * cross-PROJECT. The `projectOf` accessor is already threaded through opts.
 */
function bridgeDomainsOf(analysis, bridgeBands /*, projectOf */) {
  const bands = new Set(bridgeBands);
  const domains = new Set();
  for (const pair of analysis.domainPairs || []) {
    if (pair.a === pair.b) continue; // distinct primary domains only
    if (!bands.has(pair.band)) continue; // must be a qualifying (serendipity) bridge
    // SEAM (cross-project): also require projectOf(pair.a) !== projectOf(pair.b)
    // once a multi-project corpus exists. No-op today (single project).
    domains.add(pair.a);
    domains.add(pair.b);
  }
  return domains;
}

/** Per-cohort outcome bundle over an already-partitioned member array. */
function cohortStats(members, funnel, convergentIds, bridgeDomains) {
  const n = members.length; // total captures of this style (emitted included)
  let convergentCount = 0;
  let bridgeCount = 0;
  for (const disc of members) {
    const id = disc && disc.id != null ? String(disc.id) : null;
    if (id != null && convergentIds.has(id)) convergentCount += 1;
    const dom = primaryDomain(disc);
    if (dom != null && bridgeDomains.has(dom)) bridgeCount += 1;
  }
  return {
    n, // cohort size (all captures of this style, pre-triage backlog included)
    captured: funnel.captured, // reached New+ (gate-applied denominator)
    pursued: funnel.pursued, // reached Active
    shipped: funnel.shipped,
    emitterBacklog: funnel.emitterBacklog, // pre-triage volume, unweighted
    convergentCount,
    bridgeCount,
    // promotion = capture→hit rate (spec §1.1): reached Active / captured.
    promotionRate: safeRate(funnel.pursued, funnel.captured),
    // participation shares are over the whole cohort n (the reflex-vs-ritual
    // question is about the STYLE, so cheap ambient volume is in the denominator).
    convergenceRate: safeRate(convergentCount, n),
    bridgeRate: safeRate(bridgeCount, n),
  };
}

/**
 * reflexVsRitual — the head-to-head comparison that answers "reflex vs ritual".
 *
 * @param {Array<Object>} discoveries  the corpus (board discoveries / emitted notes)
 * @param {Object} [opts]
 * @param {Object}   [opts.state]        steering state forwarded to funnelMetrics
 * @param {Object}   [opts.provider]     embedding provider forwarded to analyzeDiscoveries
 * @param {string[]} [opts.bridgeBands]  qualifying bridge bands (default: serendipity)
 * @param {Function} [opts.projectOf]    (disc)->projectId — CROSS-PROJECT SEAM; unused today
 * @param {Object}   [opts.*]            other knobs (tauLo/tauHi/minSize/...) → analyzeDiscoveries
 * @returns {{
 *   ambient: Object, deliberate: Object, delta: Object,
 *   totals: Object, config: Object,
 * }}
 */
export function reflexVsRitual(discoveries, opts = {}) {
  const list = Array.isArray(discoveries) ? discoveries.filter((d) => d != null) : [];
  const bridgeBands = opts.bridgeBands || DEFAULT_BRIDGE_BANDS;

  // 1. Funnel (reused, gate-applied) → aggregate its captureMode slots.
  const metrics = funnelMetrics(list, { state: opts.state });
  const funnels = cohortFunnel(metrics.byCaptureMode);

  // 2. Geometry (reused) → convergence membership + cross-domain bridge domains.
  const analysis = analyzeDiscoveries(list, opts);
  const convergentIds = new Set(analysis.convergentIds);
  const bridgeDomains = bridgeDomainsOf(analysis, bridgeBands, opts.projectOf);

  // 3. Partition the corpus into the two cohorts (for participation shares).
  const members = { ambient: [], deliberate: [] };
  for (const disc of list) members[cohortOf(disc)].push(disc);

  const ambient = cohortStats(members.ambient, funnels.ambient, convergentIds, bridgeDomains);
  const deliberate = cohortStats(members.deliberate, funnels.deliberate, convergentIds, bridgeDomains);

  // 4. delta = ambient − deliberate. Positive ⇒ reflex beats ritual on that rate.
  const delta = {
    promotionRate: ambient.promotionRate - deliberate.promotionRate,
    convergenceRate: ambient.convergenceRate - deliberate.convergenceRate,
    bridgeRate: ambient.bridgeRate - deliberate.bridgeRate,
  };

  return {
    ambient,
    deliberate,
    delta,
    totals: {
      corpus: list.length,
      convergences: analysis.convergences.length,
      bridgeDomains: bridgeDomains.size,
    },
    config: {
      ambientMode: AMBIENT_MODE,
      bridgeBands: Array.from(bridgeBands),
      // What is measured NOW vs the seam left for later.
      bridgeScope: "cross-domain (within one project/corpus)",
      crossProjectSeam:
        "TRUE cross-project bridges need a multi-project corpus; add a projectOf() distinct-project guard in bridgeDomainsOf() when the single store spans projects.",
    },
  };
}

export default reflexVsRitual;
