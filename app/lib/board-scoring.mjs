// board-scoring.mjs — S2-6 adapter: wire the geometric engines into the board UI.
// ============================================================================
// A thin, additive, nullable-safe bridge between app/discovery-board.jsx and the
// two pure-ESM engines that already landed and are unit-tested:
//
//   • semantic-convergence.mjs → geometric :Convergence detection. Replaces the
//     board's manual per-discovery `convergence` boolean with the derived
//     definition (≥3 discoveries linked `converges-with`, spanning ≥3 DISTINCT
//     primary domains — same-domain agreement is redundancy, not convergence).
//   • steering-loop.mjs        → ValueScore under the PO-ratified weights.
//     Surfaces a value ranking beside the stored `priorityScore`.
//
// The board persists discoveries in its OWN shape; the S1-0/S2-1 facet fields
// (surprise, generality, distanceBand, impact, …) are all OPTIONAL. This adapter
// maps that shape onto the steering-loop "facet profile" and GUARDS every result
// so a discovery missing the newer facets still scores as a finite number and
// never throws. No lifecycle / STATUS_META / stored-field changes — purely
// additive, so old saved discoveries (localStorage v1) keep loading unchanged.
//
// The board and the standalone smoke test both import from HERE, so the exact
// scoring path the UI runs is the one under test (no logic drift).
// ============================================================================

import { valueScore, defaultState } from "./steering-loop.mjs";
import {
  convergentDiscoveryIds,
  detectConvergences,
} from "./semantic-convergence.mjs";

// Re-export the geometric convergence detectors so the board has a single import.
export { convergentDiscoveryIds, detectConvergences, defaultState };

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * Map a board discovery record onto the steering-loop facet profile.
 *
 * Nullable-safety strategy: steering-loop reads several numeric facets via
 * `Number(...)`, which would yield NaN (→ NaN ValueScore) for a discovery that
 * predates the S2-1 delta. We therefore substitute each ABSENT numeric facet
 * with the MINIMUM of its scale, so its sub-score g_f = 0 — "no evidence, no
 * credit" — rather than fabricating a middle value. Facets the board never
 * stores yet (impact, serendipityPotential) simply contribute 0 until captured.
 *
 * Distance: prefer the raw numeric `domainDistance` (0..1) as the continuous
 * idea-distance; otherwise the stored `distanceBand` label drives a
 * representative distance inside steering-loop; otherwise it defaults to the
 * band center. `generality`/`type`, when absent, hit steering-loop's own
 * built-in `?? ` fallbacks (point / TypeMult 1.0).
 */
export function toValueProfile(disc) {
  const d = disc || {};
  return {
    type: d.type, // typeMultOf → RATIFIED_TYPEMULT[type] ?? 1.0 when unknown
    d_idea: isNum(d.domainDistance) ? d.domainDistance : undefined,
    distanceBand: d.distanceBand, // used when d_idea is absent
    surprise: isNum(d.surprise) ? d.surprise : 1, // 1..5  (absent → g=0)
    impact: isNum(d.impact) ? d.impact : 1, // 1..10 (not yet in board schema → g=0)
    generality: d.generality, // enum or undefined (gGen has its own default)
    serendipityPotential: isNum(d.serendipityPotential)
      ? d.serendipityPotential
      : 1, // 1..10 (not yet in board schema → g=0)
  };
}

/**
 * Nullable-safe ValueScore for one board discovery. Always returns a finite
 * number in [0,1], or null if (defensively) the computation is somehow
 * non-finite. Never throws — safe to call inline during render.
 */
export function scoreDiscovery(disc, state = defaultState()) {
  try {
    const s = valueScore(toValueProfile(disc), state);
    return Number.isFinite(s) ? s : null;
  } catch {
    return null;
  }
}

/**
 * Build an id→ValueScore Map over a corpus using one shared ratified state.
 * Discoveries with no id are skipped (they can't be keyed / ranked).
 */
export function valueScoreMap(discoveries, state = defaultState()) {
  const m = new Map();
  for (const d of discoveries || []) {
    if (d && d.id != null) m.set(String(d.id), scoreDiscovery(d, state));
  }
  return m;
}
