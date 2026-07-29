// semantic-convergence.mjs — S2-2 Semantic-Convergence Engine
// ============================================================================
// Geometric replacement for the board's manual `convergence` boolean.
//
// This module turns the *specs* into *code*:
//   • S1-2 (spec-distance-band.md): cosine distance `d = 1 − cos(u,v)`, the two
//     thresholds τ_lo=0.30 / τ_hi=0.70 cutting three bands, the peaked g_dist
//     value curve, and the idea-distance vs domain-distance split.
//   • S1-0 (spec-discovery-ontology.md): §4.1 `:Convergence` as a derived node
//     (≥3 discoveries mutually `converges-with`, spanning ≥3 DISTINCT primary
//     domains) and §7.3's distinct-cross-domain COUNT implemented in code.
//
// Design constraints (per the S2-2 build brief):
//   • Pluggable EmbeddingProvider so the real model is swappable.
//   • A DETERMINISTIC LOCAL FALLBACK (hashed token-frequency vector + cosine)
//     so the whole engine is testable OFFLINE — no network, no API keys, no
//     package installs.
//   • New, standalone module — does not touch app/discovery-board.jsx. Wiring
//     into the board UI is a later step.
//
// Everything here is pure ESM with zero dependencies.
// ============================================================================

// ── Thresholds & knobs (S1-2 §3 pre-embedding priors — recalibrate later) ────
export const DEFAULTS = Object.freeze({
  TAU_LO: 0.30, // cliché edge  — below this, pairs are restatements (too-close)
  TAU_HI: 0.70, // noise edge   — above this, pairs are unrelated  (too-far)
  C: 0.50,      // band center / g_dist peak
  SIGMA: 0.13,  // g_dist curve width
  FLOOR_NEAR: 0.20, // g_dist floor for d ≤ c (cliché tail — still some value)
  FLOOR_FAR: 0.15,  // g_dist floor for d >  c (noise tail — penalized more)
  EMBED_DIM: 512,   // local fallback embedding dimensionality
});

export const BANDS = Object.freeze({
  TOO_CLOSE: 'too-close',
  SERENDIPITY: 'serendipity-band',
  TOO_FAR: 'too-far',
});

// ── The connective glyphs the board uses to write a connection's two poles ───
// Sample titles read "source → target" or "source ↔ target"; we split on these
// to recover the two poles of a connection when explicit pole fields are absent.
const POLE_SEPARATORS = /\s*(?:→|↦|↔|⇄|<->|->|<=>|=>)\s*/;

// ────────────────────────────────────────────────────────────────────────────
// EmbeddingProvider interface
// ────────────────────────────────────────────────────────────────────────────
// An EmbeddingProvider is any object exposing:
//   • dim: number                       — vector dimensionality
//   • embed(text: string): number[]     — returns a (dense) vector; may be async
//   • embedMany(texts): number[][]      — optional batch helper
//
// The real production provider (a sentence-embedding model, per S1-2 §1) is
// swapped in by satisfying this shape. The local fallback below satisfies it
// deterministically and offline so tests never need a model.

/**
 * Deterministic, offline embedding provider.
 *
 * Builds a hashed token-frequency (bag-of-words) vector and L2-normalizes it,
 * so cosine similarity reduces to weighted token overlap. It is NOT a semantic
 * model — it is a stable stand-in that (a) makes cosine geometry exercisable
 * without any network/model, and (b) is fully reproducible for unit tests.
 * The real model plugs in via the same interface.
 */
export class LocalHashEmbeddingProvider {
  constructor({ dim = DEFAULTS.EMBED_DIM } = {}) {
    this.dim = dim;
  }

  embed(text) {
    const vec = new Float64Array(this.dim);
    const tokens = tokenize(text);
    for (const tok of tokens) {
      vec[fnv1a(tok) % this.dim] += 1;
    }
    // L2-normalize so cosine == dot product (and zero-vectors stay zero).
    let mag = 0;
    for (let i = 0; i < this.dim; i++) mag += vec[i] * vec[i];
    mag = Math.sqrt(mag);
    if (mag > 0) for (let i = 0; i < this.dim; i++) vec[i] /= mag;
    return Array.from(vec);
  }

  embedMany(texts) {
    return texts.map((t) => this.embed(t));
  }
}

// Lowercase, split on non-alphanumerics, drop empties. Deterministic.
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// FNV-1a 32-bit hash — deterministic, no randomness, stable across runs.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (stays in 32-bit unsigned range).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Vector math + the distance metric (S1-2 §1)
// ────────────────────────────────────────────────────────────────────────────
export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function magnitude(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

/** Cosine similarity in [-1, 1]; 0 when either vector is null. */
export function cosine(a, b) {
  const ma = magnitude(a);
  const mb = magnitude(b);
  if (ma === 0 || mb === 0) return 0;
  return dot(a, b) / (ma * mb);
}

/** The S1-2 metric: `d = 1 − cos(u, v)`. Clamped to [0, 2]; ≈[0,1] in practice. */
export function cosineDistance(a, b) {
  return 1 - cosine(a, b);
}

/** Mean of a list of equal-length vectors (a centroid). Empty → null. */
export function centroid(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Band classification (S1-2 §2) — one source of truth for both the soft g_dist
// weight and the hard BridgeShape claim-check.
// ────────────────────────────────────────────────────────────────────────────
export function classifyBand(d, { tauLo = DEFAULTS.TAU_LO, tauHi = DEFAULTS.TAU_HI } = {}) {
  if (d < tauLo) return BANDS.TOO_CLOSE;
  if (d > tauHi) return BANDS.TOO_FAR;
  return BANDS.SERENDIPITY; // τ_lo ≤ d ≤ τ_hi
}

/**
 * S1-2 §4 peaked value curve: a Gaussian bump centered at c with asymmetric
 * tail floors so the ratified anchors (cliché 0.20 < noise… wait: near 0.20,
 * far 0.15) are reproduced and no region is ever zero (no-exclusion).
 *
 *   g_dist(d) = max( floor(d), exp( −(d − c)² / (2σ²) ) )
 *   floor(d)  = 0.20 if d ≤ c   (near/cliché tail)
 *               0.15 if d >  c   (far/noise tail)
 */
export function gDist(d, {
  c = DEFAULTS.C, sigma = DEFAULTS.SIGMA,
  floorNear = DEFAULTS.FLOOR_NEAR, floorFar = DEFAULTS.FLOOR_FAR,
} = {}) {
  const bump = Math.exp(-((d - c) ** 2) / (2 * sigma * sigma));
  const floor = d <= c ? floorNear : floorFar;
  return Math.max(floor, bump);
}

// ────────────────────────────────────────────────────────────────────────────
// Idea-distance (S1-2): between the two POLES of a connection — the source
// insight and the target application the discovery links.
// ────────────────────────────────────────────────────────────────────────────
/**
 * Recover the two poles of a discovery's connection. Preference order:
 *   1. explicit `discovery.poles = { source, target }` (or `[source, target]`)
 *   2. explicit `discovery.sourceInsight` / `discovery.targetApplication`
 *   3. split the `title` on a connective glyph (→ / ↔ / ->, …)
 * Returns { source, target } of strings, or null if two poles can't be found.
 */
export function extractPoles(discovery) {
  const p = discovery && discovery.poles;
  if (p) {
    if (Array.isArray(p) && p.length >= 2) return { source: String(p[0]), target: String(p[1]) };
    if (p.source != null && p.target != null) return { source: String(p.source), target: String(p.target) };
  }
  if (discovery && discovery.sourceInsight != null && discovery.targetApplication != null) {
    return { source: String(discovery.sourceInsight), target: String(discovery.targetApplication) };
  }
  const title = discovery && discovery.title;
  if (title && POLE_SEPARATORS.test(title)) {
    const parts = String(title).split(POLE_SEPARATORS).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { source: parts[0], target: parts[parts.length - 1] };
  }
  return null;
}

/**
 * Idea-distance for one discovery: `d = 1 − cos(embed(source), embed(target))`.
 * Returns { distance, band, gDist, poles } or null when poles aren't separable
 * (S1-2 note: fall back to domain-distance in that case — see analyzeDiscoveries).
 */
export function ideaDistance(discovery, provider, opts = {}) {
  const poles = extractPoles(discovery);
  if (!poles) return null;
  const d = cosineDistance(provider.embed(poles.source), provider.embed(poles.target));
  return { distance: d, band: classifyBand(d, opts), gDist: gDist(d, opts), poles };
}

// ────────────────────────────────────────────────────────────────────────────
// Domain-distance (S1-2): between the embedding CENTROIDS of two SKOS domain
// concepts. A centroid = mean embedding of the ideas anchored to that concept
// (or a representative descriptor at cold-start).
// ────────────────────────────────────────────────────────────────────────────
/** The discovery's primary domain (F2). Tolerant of several S2-1 shapes. */
export function primaryDomain(discovery) {
  if (!discovery) return null;
  if (discovery.primaryDomain != null) return String(discovery.primaryDomain);
  const doms = discovery.domains;
  if (Array.isArray(doms) && doms.length) {
    // domains[] may be strings, or objects flagged { id/name, primary:true }.
    const flagged = doms.find((x) => x && typeof x === 'object' && x.primary);
    const pick = flagged || doms[0];
    if (pick && typeof pick === 'object') return String(pick.id ?? pick.name ?? pick.label);
    return String(pick);
  }
  // Cold-start fallback: the capture agent lens is the domain concept (§3).
  if (discovery.sourceAgent != null) return String(discovery.sourceAgent);
  return null;
}

/** Descriptive text to embed for a domain, per discovery (for centroid means). */
function domainText(discovery) {
  const bits = [];
  if (discovery.summary) bits.push(discovery.summary);
  if (discovery.title) bits.push(discovery.title);
  if (Array.isArray(discovery.tags)) bits.push(discovery.tags.join(' '));
  return bits.join(' ') || String(primaryDomain(discovery) || '');
}

/**
 * Build a Map<domainId, centroidVector> from a corpus of discoveries.
 * Each domain's centroid = mean embedding of its members' descriptive text.
 * A domain with a single member cold-starts on that member's descriptor.
 */
export function domainCentroids(discoveries, provider) {
  const byDomain = new Map();
  for (const disc of discoveries) {
    const dom = primaryDomain(disc);
    if (dom == null) continue;
    if (!byDomain.has(dom)) byDomain.set(dom, []);
    byDomain.get(dom).push(provider.embed(domainText(disc)));
  }
  const out = new Map();
  for (const [dom, vecs] of byDomain) out.set(dom, centroid(vecs));
  return out;
}

/** Domain-distance between two domains given a centroid map. null if unknown. */
export function domainDistance(domA, domB, centroids, opts = {}) {
  const a = centroids.get(domA);
  const b = centroids.get(domB);
  if (!a || !b) return null;
  const d = cosineDistance(a, b);
  return { distance: d, band: classifyBand(d, opts) };
}

// ────────────────────────────────────────────────────────────────────────────
// Convergence detection (S1-0 §4.1 + §7.3)
// ────────────────────────────────────────────────────────────────────────────
// A `:Convergence` is a DERIVED node binding ≥3 discoveries mutually linked by
// `converges-with`, spanning ≥3 DISTINCT primary domains. Same-domain agreement
// is redundancy, not convergence — so a 3-discovery / 2-domain cluster must NOT
// fire. This replaces the manual per-discovery `convergence` boolean.
//
// Implementation of §7.3's `COUNT(DISTINCT ?domain) >= 3`:
//   1. Build an undirected graph from `converges-with` relations (symmetric).
//   2. Find connected components (the "same underlying insight" clusters).
//   3. A component fires iff it has ≥3 discoveries AND ≥3 distinct primary
//      domains among them.

const CONVERGES_WITH = 'converges-with';

/** Pull the set of converges-with neighbour ids declared on a discovery. */
function convergesEdges(discovery) {
  const out = [];
  const rels = discovery && discovery.relations;
  if (Array.isArray(rels)) {
    for (const r of rels) {
      if (r && (r.kind === CONVERGES_WITH || r.type === CONVERGES_WITH) && r.toId != null) {
        out.push(String(r.toId));
      }
    }
  }
  return out;
}

/**
 * Detect Convergence events over an array of discovery objects.
 *
 * @returns {Array<{ members:string[], domains:string[], domainCount:number,
 *                    size:number }>} one entry per fired Convergence node.
 */
export function detectConvergences(discoveries, {
  minSize = 3, minDomains = 3,
} = {}) {
  const byId = new Map();
  for (const d of discoveries) if (d && d.id != null) byId.set(String(d.id), d);

  // Build a symmetric adjacency list. converges-with is owl:SymmetricProperty,
  // so we add both directions even if only one side declared the edge, but we
  // only connect ids that actually exist in the corpus.
  const adj = new Map();
  const ensure = (id) => { if (!adj.has(id)) adj.set(id, new Set()); return adj.get(id); };
  for (const [id, disc] of byId) {
    ensure(id);
    for (const nbr of convergesEdges(disc)) {
      if (!byId.has(nbr)) continue; // dangling edge — ignore
      ensure(id).add(nbr);
      ensure(nbr).add(id); // symmetry
    }
  }

  // Connected components via BFS.
  const seen = new Set();
  const events = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    const members = [];
    while (queue.length) {
      const cur = queue.shift();
      members.push(cur);
      for (const nbr of adj.get(cur)) {
        if (!seen.has(nbr)) { seen.add(nbr); queue.push(nbr); }
      }
    }

    // §7.3: count DISTINCT primary domains across the component's members.
    const domains = new Set();
    for (const id of members) {
      const dom = primaryDomain(byId.get(id));
      if (dom != null) domains.add(dom);
    }

    if (members.length >= minSize && domains.size >= minDomains) {
      events.push({
        members: members.sort(),
        domains: Array.from(domains).sort(),
        domainCount: domains.size,
        size: members.length,
      });
    }
  }
  return events;
}

/**
 * Convenience: return a Set of discovery ids that participate in ANY fired
 * Convergence — the geometric replacement for the manual `convergence` flag.
 */
export function convergentDiscoveryIds(discoveries, opts = {}) {
  const ids = new Set();
  for (const ev of detectConvergences(discoveries, opts)) {
    for (const id of ev.members) ids.add(id);
  }
  return ids;
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level: analyze a whole array of discovery objects (S2-1 fields).
// ────────────────────────────────────────────────────────────────────────────
/**
 * Run the full S2-2 geometry over a corpus:
 *   • per-discovery idea-distance + band + g_dist (falls back to domain-distance
 *     between the discovery's primary & secondary domains when poles aren't
 *     separable, per S1-2's "fallback when idea poles aren't separable");
 *   • the domain centroid map + a matrix of pairwise domain-distances;
 *   • fired Convergence events and the set of convergent discovery ids.
 *
 * @param discoveries array of discovery objects
 * @param opts { provider?, tauLo?, tauHi?, c?, sigma?, minSize?, minDomains? }
 */
export function analyzeDiscoveries(discoveries, opts = {}) {
  const provider = opts.provider || new LocalHashEmbeddingProvider();
  const centroids = domainCentroids(discoveries, provider);

  const perDiscovery = discoveries.map((disc) => {
    let idea = ideaDistance(disc, provider, opts);
    let source = 'idea';
    // Fallback: if the two poles aren't separable, use domain-distance between
    // the discovery's primary and first secondary domain (S1-2 §1).
    if (!idea) {
      const prim = primaryDomain(disc);
      const secondary = secondaryDomains(disc)[0];
      const dd = prim != null && secondary != null
        ? domainDistance(prim, secondary, centroids, opts) : null;
      if (dd) { idea = { distance: dd.distance, band: dd.band, gDist: gDist(dd.distance, opts), poles: null }; source = 'domain'; }
    }
    return {
      id: disc.id != null ? String(disc.id) : null,
      primaryDomain: primaryDomain(disc),
      distance: idea ? idea.distance : null,
      distanceBand: idea ? idea.band : null,
      gDist: idea ? idea.gDist : null,
      distanceSource: idea ? source : null,
      poles: idea ? idea.poles : null,
    };
  });

  // Pairwise domain-distance matrix (upper triangle) over known domains.
  const domainNames = Array.from(centroids.keys()).sort();
  const domainPairs = [];
  for (let i = 0; i < domainNames.length; i++) {
    for (let j = i + 1; j < domainNames.length; j++) {
      const dd = domainDistance(domainNames[i], domainNames[j], centroids, opts);
      if (dd) domainPairs.push({ a: domainNames[i], b: domainNames[j], distance: dd.distance, band: dd.band });
    }
  }

  const convergences = detectConvergences(discoveries, opts);
  const convergentIds = new Set();
  for (const ev of convergences) for (const id of ev.members) convergentIds.add(id);

  return {
    perDiscovery,
    domains: domainNames,
    domainPairs,
    convergences,
    convergentIds: Array.from(convergentIds).sort(),
  };
}

/** Secondary domains (F2) of a discovery, tolerant of several shapes. */
function secondaryDomains(discovery) {
  if (!discovery) return [];
  if (Array.isArray(discovery.secondaryDomains)) return discovery.secondaryDomains.map(String);
  const doms = discovery.domains;
  if (Array.isArray(doms) && doms.length > 1) {
    const prim = primaryDomain(discovery);
    return doms
      .map((x) => (x && typeof x === 'object' ? String(x.id ?? x.name ?? x.label) : String(x)))
      .filter((x) => x !== prim);
  }
  return [];
}
