#!/usr/bin/env python3
"""
serendipity_engine.py
=====================
Zero-dependency mathematical and geometric engine for the Serendipity Maximizer v2 plugin.

Core principles:
  1. De-jargonize first: zero static domain packs, zero role/stage intake, zero IP bleed.
  2. Similarity != Serendipity: decomposes distance into Domain Separation (d_domain)
     and Structural Mechanism Isomorphism (s_mechanism):
         d = 0.5 * d_domain + 0.5 * (1 - s_mechanism)
     - Cliche (same domain, obvious mechanism)       -> d < 0.30  (too-close, floor 0.20)
     - Serendipity (orthogonal domain + isomorphism) -> 0.30..0.70 (serendipity-band, peak 1.0)
     - Noise (orthogonal domain, no shared mechanism)-> d > 0.70  (too-far, floor 0.15)
  3. Integrity without exclusion: a 'Bridge' (B) claim in too-close is retyped, never dropped.
  4. Independent Convergence: 2+ distinct orthogonal lenses landing on the same underlying
     mechanism triggers a Convergence signal that overrides individual scores.
  5. Subtle ambient memory + UCB exploration reserve: stores domain-neutral mechanism sparks
     locally in ~/.gemini/serendipity/ (outside git) and adapts weights with L2 shrinkage.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

__version__ = "2.0.0"

# ---------------------------------------------------------------------------
# Constants & Ratified Priors
# ---------------------------------------------------------------------------

MOVES = ("A", "B", "C", "D")
MOVE_NAMES = {
    "A": "Anomaly",
    "B": "Bridge",
    "C": "Constraint Flip",
    "D": "Scale Shift",
}

BAND_TOO_CLOSE = "too-close"
BAND_SERENDIPITY = "serendipity-band"
BAND_TOO_FAR = "too-far"

EFFORT_WEIGHTS = {"low": 1.0, "med": 2.0, "medium": 2.0, "high": 4.0}

RATIFIED_WEIGHTS: Dict[str, float] = {
    "dist": 0.28,  # Mid-distance cross-domain geometry (guards against cliche & noise)
    "surp": 0.27,  # Assumption-violation / counter-intuitiveness
    "lev": 0.27,   # Actionable leverage on the core tension
    "nov": 0.18,   # Novelty relative to prior banked/captured sparks
}

RATIFIED_TYPE_MULT: Dict[str, float] = {
    "A": 0.95,  # Anomaly held high (penicillin lesson)
    "B": 1.00,  # Cross-domain Bridge
    "C": 0.96,  # Constraint Flip
    "D": 0.92,  # Scale Shift
}

RATIFIED_BAND: Dict[str, float] = {
    "c": 0.50,
    "sigma": 0.13,
    "tau_lo": 0.30,
    "tau_hi": 0.70,
    "floor_near": 0.20,
    "floor_far": 0.15,
}

GUARDRAILS = {
    "weight_floor": 0.05,
    "type_mult_floor": 0.80,
    "step_cap": 0.15,
    "cold_start_k": 10,
    "lr": 0.35,
    "shrinkage": 0.15,
    "band_c_min": 0.35,
    "band_c_max": 0.65,
    "explore_beta": 0.30,
}

OUTCOME_VALUES = {
    "shipped": 1.0,
    "pursued": 0.75,
    "delayed": 0.85,   # Banked spark later pursued/shipped -> retroactive reward
    "banked": 0.35,    # Kept for future trigger, neutral-positive hold
    "dismissed": 0.0,
}

STOPWORDS: Set[str] = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
    "how", "in", "into", "is", "it", "its", "of", "on", "or", "our", "so", "such",
    "than", "that", "the", "their", "them", "then", "there", "these", "this", "to",
    "too", "use", "using", "via", "was", "we", "when", "where", "which", "while",
    "with", "without", "can", "could", "would", "should", "need", "needs", "system",
    "problem", "approach", "method", "design", "make", "making", "high", "low",
}

# ---------------------------------------------------------------------------
# 16 Universal Structural Operator Axes (Domain-Neutral Physics/Logic Basis)
# ---------------------------------------------------------------------------

STRUCTURAL_OPERATORS: Dict[str, Tuple[str, ...]] = {
    "thermal_phase": (
        "thermal", "heat", "cool", "cooling", "temperature", "insulat", "phase",
        "entropy", "dissipat", "gradient", "latent", "boil", "freeze", "exchanger",
    ),
    "stiffness_compliance": (
        "stiff", "stiffness", "compliant", "compliance", "flexure", "buckl", "hinge",
        "elastic", "strain", "stress", "bend", "bistable", "snap", "preload", "tension",
    ),
    "flow_routing": (
        "flow", "congest", "queue", "packet", "routing", "route", "branch", "throughput",
        "backpressure", "bottleneck", "valve", "manifold", "vascular", "channel", "flux",
    ),
    "feedback_control": (
        "feedback", "damp", "damping", "oscillat", "resonan", "homeosta", "overshoot",
        "latency", "stabil", "control", "loop", "gain", "setpoint", "lag", "drift",
    ),
    "surface_interface": (
        "surface", "boundary", "friction", "adhes", "wetting", "membrane", "seal",
        "coating", "shear", "drag", "interface", "contact", "slip", "barrier", "seam",
    ),
    "scale_geometry": (
        "scale", "scaling", "fractal", "origami", "kirigami", "auxetic", "tessellat",
        "modular", "lattice", "multiscale", "packing", "area", "volume", "fold", "tile",
    ),
    "asymmetry_ratchet": (
        "asymmetr", "ratchet", "diode", "one-way", "escapement", "anisotrop", "direction",
        "irrevers", "latch", "rectif", "check-valve", "nonreciprocal", "unidirection",
    ),
    "signal_sparsity": (
        "signal", "noise", "threshold", "stochastic", "sparse", "sparsity", "compress",
        "filter", "outlier", "anomaly", "alias", "sample", "sensor", "detect", "snr",
    ),
    "energy_duty_cycle": (
        "energy", "power", "pulse", "burst", "intermittent", "flywheel", "capacitor",
        "duty", "dorman", "harvest", "peak", "buffer", "storage", "discharge",
    ),
    "fault_sacrificial": (
        "fault", "redundan", "graceful", "degrad", "quorum", "self-heal", "sacrificial",
        "fuse", "isolat", "immune", "repair", "fail", "failure", "crack", "arrest",
    ),
    "search_allocation": (
        "search", "explor", "exploit", "bandit", "forag", "swarm", "auction", "allocat",
        "schedule", "pareto", "triage", "priorit", "scarcity", "market", "dispatch",
    ),
    "impedance_coupling": (
        "impedance", "match", "coupling", "coupled", "decoupl", "transform", "lever",
        "gear", "transmiss", "wave", "acoustic", "attenuat", "reflect", "bridge",
    ),
    "state_hysteresis": (
        "hysteresis", "memory", "anneal", "lock", "plastic", "cache", "checkpoint",
        "reversible", "path-depend", "switch", "state", "quench", "temper",
    ),
    "timing_entrainment": (
        "sync", "synchron", "asynchron", "clock", "event", "cadence", "refractory",
        "entrain", "jitter", "deadline", "rate", "frequency", "phase-lock",
    ),
    "constraint_inversion": (
        "constraint", "limit", "limitation", "parasitic", "waste", "defect", "artifact",
        "tolerance", "slack", "jam", "jamming", "preload", "prestress", "flip", "invert",
    ),
    "self_assembly": (
        "assembl", "templat", "scaffold", "prune", "pruning", "morph", "deploy",
        "unfold", "shingle", "interlock", "zipper", "join", "fasten",
    ),
}

# ---------------------------------------------------------------------------
# Curated Cross-Disciplinary Orthogonal Lens Catalog (Zero Venture Jargon)
# ---------------------------------------------------------------------------

ORTHOGONAL_LENSES: List[Dict[str, Any]] = [
    {
        "id": "intertidal-biomechanics",
        "domain": "Intertidal & Abyssal Marine Biomechanics",
        "default_move": "B",
        "operators": ["stiffness_compliance", "fault_sacrificial", "surface_interface", "impedance_coupling"],
        "mechanisms": "Mussel byssal gradient stiffness matching, sacrificial hydrogen bonds that dissipate shock and re-form, compliant drag-reconfiguration blades.",
    },
    {
        "id": "slime-mold-routing",
        "domain": "Mycelial & Slime-Mold Decentralized Routing",
        "default_move": "B",
        "operators": ["flow_routing", "fault_sacrificial", "search_allocation", "self_assembly"],
        "mechanisms": "Flux-reinforced tube thickening with automatic pruning of low-flow links, zero-central-controller fault tolerance, local oscillatory peristalsis.",
    },
    {
        "id": "horology-escapements",
        "domain": "Mechanical Watchmaking & Horological Escapements",
        "default_move": "C",
        "operators": ["asymmetry_ratchet", "timing_entrainment", "stiffness_compliance", "thermal_phase"],
        "mechanisms": "Deadbeat & detent escapements converting continuous force into quantized impulses, bimetallic thermal self-compensation, monolithic compliant flexures.",
    },
    {
        "id": "spacecraft-passive-mechanisms",
        "domain": "Spacecraft Passive Thermal & Deployable Mechanisms",
        "default_move": "C",
        "operators": ["thermal_phase", "self_assembly", "stiffness_compliance", "energy_duty_cycle"],
        "mechanisms": "Loop heat pipes with capillary wicks, bimetallic passive radiative louvres, stored-strain tape-spring hinges that self-latch on deployment.",
    },
    {
        "id": "congestion-backpressure",
        "domain": "Network Congestion Control & Distributed Backpressure",
        "default_move": "B",
        "operators": ["flow_routing", "feedback_control", "signal_sparsity", "timing_entrainment"],
        "mechanisms": "Additive-increase/multiplicative-decrease (AIMD), token-bucket burst shaping, explicit congestion notification before queues overflow.",
    },
    {
        "id": "plant-hygroscopic-actuation",
        "domain": "Plant Hydraulics & Hygroscopic Snap-Actuation",
        "default_move": "C",
        "operators": ["stiffness_compliance", "constraint_inversion", "flow_routing", "asymmetry_ratchet"],
        "mechanisms": "Pine-cone bilayer swelling where humidity drives zero-power actuation, xylem torus-margo cavitation check valves, Venus flytrap elastic instability snap.",
    },
    {
        "id": "seismic-damping",
        "domain": "Seismic Base Isolation & Nonlinear Energy Sinks",
        "default_move": "C",
        "operators": ["feedback_control", "fault_sacrificial", "impedance_coupling", "stiffness_compliance"],
        "mechanisms": "Friction-pendulum period shifting, sacrificial replaceable shear links, targeted energy transfer into broadband nonlinear absorbers.",
    },
    {
        "id": "allosteric-immunology",
        "domain": "Cellular Allosteric Signaling & Negative-Selection Immunology",
        "default_move": "A",
        "operators": ["signal_sparsity", "state_hysteresis", "fault_sacrificial", "search_allocation"],
        "mechanisms": "Thymic negative selection (detecting anomalies by censoring self-patterns), ultrasensitive Hill-curve switches, conformational lock-and-key gating.",
    },
    {
        "id": "textile-weave-jamming",
        "domain": "Textile Weave Topology, Ripstop & Granular Jamming",
        "default_move": "C",
        "operators": ["scale_geometry", "constraint_inversion", "stiffness_compliance", "surface_interface"],
        "mechanisms": "Bias-cut trellising shear deformation, ripstop periodic reinforcement grids that arrest tear propagation, vacuum-triggered granular stiffness locking.",
    },
    {
        "id": "acoustic-metamaterials",
        "domain": "Acoustic Waveguides, Horn Tapers & Phononic Bandgaps",
        "default_move": "D",
        "operators": ["impedance_coupling", "scale_geometry", "signal_sparsity", "asymmetry_ratchet"],
        "mechanisms": "Exponential impedance-matching tapers, sub-wavelength Helmholtz resonator arrays, geometric bandgaps that block specific disturbance bands.",
    },
    {
        "id": "extremophile-thermoregulation",
        "domain": "Polar & Desert Extremophile Vascular Counter-Currents",
        "default_move": "B",
        "operators": ["thermal_phase", "flow_routing", "energy_duty_cycle", "surface_interface"],
        "mechanisms": "Rete mirabile counter-current heat/solute exchangers, nasal condensation recovery, regional heterothermy and metabolic torpor.",
    },
    {
        "id": "auction-microstructure",
        "domain": "Auction Mechanism Design & Market Circuit Breakers",
        "default_move": "C",
        "operators": ["search_allocation", "constraint_inversion", "feedback_control", "timing_entrainment"],
        "mechanisms": "Vickrey truth-revealing second-price incentives, batch call-auctions that eliminate latency races, volatility circuit breakers.",
    },
    {
        "id": "kinematic-lithography",
        "domain": "Precision Kinematic Couplings & Printmaking Registration",
        "default_move": "C",
        "operators": ["constraint_inversion", "surface_interface", "scale_geometry", "self_assembly"],
        "mechanisms": "Maxwell 6-point exact-constraint grooves (zero over-constraint under thermal expansion), moire vernier alignment magnification.",
    },
    {
        "id": "metallurgy-prestress",
        "domain": "Glass Tempering, Shot-Peening & Martensitic Phase Memory",
        "default_move": "C",
        "operators": ["state_hysteresis", "thermal_phase", "stiffness_compliance", "fault_sacrificial"],
        "mechanisms": "Prince Rupert compressive surface residual stress that prevents crack opening, transformation toughening at crack tips.",
    },
    {
        "id": "radar-coded-aperture",
        "domain": "Chirp Pulse Compression & Coded-Aperture Multiplexing",
        "default_move": "D",
        "operators": ["signal_sparsity", "energy_duty_cycle", "timing_entrainment", "impedance_coupling"],
        "mechanisms": "Spreading peak energy across long frequency-swept chirps then matched-filtering back to an impulse, Hadamard mask multiplexing.",
    },
    {
        "id": "railway-interlocking",
        "domain": "Railway Fail-Safe Interlocking & Airspace Holding Stacks",
        "default_move": "A",
        "operators": ["fault_sacrificial", "flow_routing", "timing_entrainment", "state_hysteresis"],
        "mechanisms": "Physical/cryptographic single-token track occupancy, gravity-drop fail-closed semaphores, time-slotted upstream metering before merge points.",
    },
    {
        "id": "colloid-rheology",
        "domain": "Shear-Thickening Fluids, Foams & Capillary Bridges",
        "default_move": "D",
        "operators": ["surface_interface", "stiffness_compliance", "scale_geometry", "thermal_phase"],
        "mechanisms": "Hydrocluster dilatant locking under high strain-rate impact while remaining liquid at rest, Laplace-pressure self-centering meniscus alignment.",
    },
    {
        "id": "percolation-firebreaks",
        "domain": "Percolation Thresholds & Mosaic Firebreak Ecology",
        "default_move": "D",
        "operators": ["scale_geometry", "fault_sacrificial", "search_allocation", "signal_sparsity"],
        "mechanisms": "Keeping connectivity just below critical percolation p_c so cascades self-extinguish, heterogeneous fuel-break mosaics.",
    },
]


# ---------------------------------------------------------------------------
# Storage Paths & Persistence
# ---------------------------------------------------------------------------

def get_store_dir() -> Path:
    override = os.environ.get("SERENDIPITY_HOME", "").strip()
    base = Path(override).expanduser() if override else (Path.home() / ".gemini" / "serendipity")
    base.mkdir(parents=True, exist_ok=True)
    return base


def sparks_path() -> Path:
    return get_store_dir() / "sparks.jsonl"


def steering_path() -> Path:
    return get_store_dir() / "steering.json"


def default_steering_state() -> Dict[str, Any]:
    return {
        "version": __version__,
        "weights": dict(RATIFIED_WEIGHTS),
        "type_mult": dict(RATIFIED_TYPE_MULT),
        "band": dict(RATIFIED_BAND),
        "region_counts": {},
        "recent_lenses": [],
        "outcomes": [],
    }


def load_steering_state() -> Dict[str, Any]:
    p = steering_path()
    base = default_steering_state()
    if not p.is_file():
        return base
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            for k in ("weights", "type_mult", "band"):
                if isinstance(raw.get(k), dict):
                    base[k].update({ fk: float(fv) for fk, fv in raw[k].items() if isinstance(fv, (int, float)) })
            if isinstance(raw.get("region_counts"), dict):
                base["region_counts"] = {str(k): int(v) for k, v in raw["region_counts"].items()}
            if isinstance(raw.get("recent_lenses"), list):
                base["recent_lenses"] = [str(x) for x in raw["recent_lenses"][-16:]]
            if isinstance(raw.get("outcomes"), list):
                base["outcomes"] = raw["outcomes"][-200:]
    except Exception:
        return default_steering_state()
    return base


def save_steering_state(state: Dict[str, Any]) -> None:
    p = steering_path()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(p)


def load_sparks() -> List[Dict[str, Any]]:
    p = sparks_path()
    if not p.is_file():
        return []
    out: List[Dict[str, Any]] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s:
            continue
        try:
            obj = json.loads(s)
            if isinstance(obj, dict) and obj.get("id"):
                out.append(obj)
        except json.JSONDecodeError:
            continue
    return out


def save_sparks(items: List[Dict[str, Any]]) -> None:
    p = sparks_path()
    tmp = p.with_suffix(".tmp")
    payload = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in items)
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(p)


# ---------------------------------------------------------------------------
# Feature Extraction, Distance & Serendipity Geometry
# ---------------------------------------------------------------------------

def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else (hi if x > hi else x)


def tokenize(text: str) -> List[str]:
    words = re.findall(r"[a-z0-9]{2,}", (text or "").lower())
    return [w for w in words if w not in STOPWORDS]


def _stem_lite(word: str) -> str:
    for suffix in ("ization", "ational", "iveness", "ing", "tion", "sion", "ment", "ness", "ity", "ies", "es", "ed", "ly", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def hashed_ngram_vec(text: str, dim: int = 256) -> List[float]:
    """Deterministic subword + stem vector for zero-dependency offline similarity."""
    vec = [0.0] * dim
    toks = tokenize(text)
    for t in toks:
        st = _stem_lite(t)
        h_word = int(hashlib.blake2b(st.encode("utf-8"), digest_size=4).hexdigest(), 16)
        vec[h_word % dim] += 1.5
        padded = f"<{st}>"
        for i in range(max(0, len(padded) - 3)):
            tri = padded[i : i + 4]
            h_tri = int(hashlib.blake2b(tri.encode("utf-8"), digest_size=4).hexdigest(), 16)
            vec[h_tri % dim] += 0.5
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0.0:
        vec = [v / norm for v in vec]
    return vec


def cosine_sim(a: Iterable[float], b: Iterable[float]) -> float:
    dot_val = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot_val += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return _clamp(dot_val / math.sqrt(na * nb), 0.0, 1.0)


def extract_operators(text: str) -> Dict[str, float]:
    """Map arbitrary text onto the 16 domain-neutral structural operator axes."""
    lower = (text or "").lower()
    scores: Dict[str, float] = {}
    for op, prefixes in STRUCTURAL_OPERATORS.items():
        hits = 0
        for pref in prefixes:
            if pref in lower:
                hits += 1
        if hits > 0:
            scores[op] = min(1.0, 0.45 + 0.22 * (hits - 1))
    return scores


def operator_similarity(ops_a: Dict[str, float], ops_b: Dict[str, float]) -> float:
    if not ops_a or not ops_b:
        return 0.0
    keys = set(ops_a) | set(ops_b)
    num = sum(min(ops_a.get(k, 0.0), ops_b.get(k, 0.0)) for k in keys)
    den = sum(max(ops_a.get(k, 0.0), ops_b.get(k, 0.0)) for k in keys)
    return _clamp(num / den, 0.0, 1.0) if den > 0.0 else 0.0


def domain_separation(source_domain: str, lens_domain: str) -> float:
    """Surface domain distance in [0, 1]. 0 = identical domain, 1 = completely orthogonal."""
    if not source_domain.strip() or not lens_domain.strip():
        return 0.65
    va = hashed_ngram_vec(source_domain)
    vb = hashed_ngram_vec(lens_domain)
    return _clamp(1.0 - cosine_sim(va, vb), 0.0, 1.0)


def mechanism_isomorphism(tension_text: str, candidate_mechanism_text: str) -> Tuple[float, List[str]]:
    """
    Structural isomorphism s_mechanism in [0, 1] between a core tension and a candidate
    mechanism, combining universal operator overlap and stem/subword transfer.
    """
    ops_t = extract_operators(tension_text)
    ops_c = extract_operators(candidate_mechanism_text)
    shared_ops = sorted(set(ops_t) & set(ops_c))
    op_sim = operator_similarity(ops_t, ops_c)
    lex_sim = cosine_sim(hashed_ngram_vec(tension_text), hashed_ngram_vec(candidate_mechanism_text))

    if ops_t and ops_c:
        # Boost when concrete structural operators bridge across totally different vocabularies
        op_boost = min(1.0, op_sim * 1.25 + 0.12 * len(shared_ops))
        s_mech = _clamp(0.68 * op_boost + 0.32 * lex_sim, 0.0, 1.0)
    else:
        s_mech = _clamp(lex_sim, 0.0, 1.0)
    return s_mech, shared_ops


def serendipity_distance(
    source_domain: str,
    lens_domain: str,
    core_tension: str,
    mechanism_text: str,
) -> Dict[str, Any]:
    """
    Compute effective serendipity distance:
        raw_d = 0.5 * d_domain + 0.5 * (1 - s_mechanism)
    Echo-chamber guard: if d_domain < tau_lo (never left the source domain), poor mechanism
    overlap cannot artificially inflate an in-domain idea into the cross-domain serendipity band,
    so d = min(d_domain, raw_d).
    """
    d_dom = domain_separation(source_domain, lens_domain)
    s_mech, shared_ops = mechanism_isomorphism(core_tension, mechanism_text)
    raw_d = 0.5 * d_dom + 0.5 * (1.0 - s_mech)
    d = min(d_dom, raw_d) if d_dom < RATIFIED_BAND["tau_lo"] else raw_d
    d = _clamp(d, 0.0, 1.0)
    return {
        "distance": round(d, 4),
        "d_domain": round(d_dom, 4),
        "s_mechanism": round(s_mech, 4),
        "shared_operators": shared_ops,
    }


def classify_band(d: float, band_cfg: Optional[Dict[str, float]] = None) -> str:
    cfg = band_cfg or RATIFIED_BAND
    if d < cfg["tau_lo"]:
        return BAND_TOO_CLOSE
    if d > cfg["tau_hi"]:
        return BAND_TOO_FAR
    return BAND_SERENDIPITY


def g_dist(d: float, band_cfg: Optional[Dict[str, float]] = None) -> float:
    """Asymmetric peaked Gaussian curve: peaks at c=0.50, floors at 0.20 (near) / 0.15 (far)."""
    cfg = band_cfg or RATIFIED_BAND
    c = cfg["c"]
    sigma = max(0.04, cfg["sigma"])
    floor = cfg.get("floor_near", 0.20) if d <= c else cfg.get("floor_far", 0.15)
    bump = math.exp(-((d - c) ** 2) / (2.0 * sigma * sigma))
    return max(floor, bump)


def corpus_novelty(text: str, existing_sparks: List[Dict[str, Any]]) -> Tuple[float, Optional[str]]:
    """
    Returns (novelty_in_0_1, nearest_spark_id).
    1.0 = completely fresh; 0.0 = exact duplicate of an already-saved spark.
    """
    if not existing_sparks:
        return 1.0, None
    v = hashed_ngram_vec(text)
    best_sim = 0.0
    best_id: Optional[str] = None
    for sp in existing_sparks:
        sp_text = f"{sp.get('mechanism', '')} {sp.get('why_surprising', '')}"
        sim = cosine_sim(v, hashed_ngram_vec(sp_text))
        if sim > best_sim:
            best_sim = sim
            best_id = str(sp.get("id"))
    return _clamp(1.0 - best_sim, 0.0, 1.0), best_id


def ucb_exploration_bonus(
    band: str,
    move: str,
    region_counts: Dict[str, int],
    beta: float = GUARDRAILS["explore_beta"],
) -> float:
    key = f"{band}:{move}"
    n = max(0, int(region_counts.get(key, 0)))
    total = sum(max(0, int(v)) for v in region_counts.values())
    salience = 1.0 if band == BAND_SERENDIPITY else (0.75 if band == BAND_TOO_FAR else 0.35)
    if move in ("C", "D", "A"):
        salience = min(1.0, salience + 0.1)
    return beta * salience * math.sqrt(math.log(total + math.e) / (n + 1.0))


# ---------------------------------------------------------------------------
# Tool 1: Plan a Serendipity Scan + Collide Timeline Sparks
# ---------------------------------------------------------------------------

def plan_scan(
    core_tension: str,
    source_domain: str,
    constraints_or_assumptions: Optional[List[str]] = None,
    n_lenses: int = 4,
) -> Dict[str, Any]:
    if not core_tension or not core_tension.strip():
        raise ValueError("core_tension must be a non-empty domain-neutral structural description.")

    n_lenses = max(2, min(6, int(n_lenses)))
    state = load_steering_state()
    sparks = load_sparks()

    full_tension = core_tension.strip()
    if constraints_or_assumptions:
        full_tension += " " + " ".join(str(x) for x in constraints_or_assumptions if x)

    tension_ops = extract_operators(full_tension)
    recent_set = set(state.get("recent_lenses", [])[-8:])
    region_counts = state.get("region_counts", {})

    # Score every lens in the catalog for:
    #   (a) High domain separation from source_domain (avoid industry echo chamber)
    #   (b) Structural operator resonance with core_tension (mid-distance bridgeability)
    #   (c) Freshness penalty if used in recent scans
    #   (d) UCB move diversity bonus
    scored_lenses: List[Tuple[float, Dict[str, Any], float, List[str]]] = []
    for lens in ORTHOGONAL_LENSES:
        d_dom = domain_separation(source_domain, f"{lens['domain']} {lens['mechanisms']}")
        if d_dom < 0.35:
            # Too close to the user's working domain -> skip echo chamber
            continue
        lens_ops = {op: 0.85 for op in lens["operators"]}
        op_sim = operator_similarity(tension_ops, lens_ops) if tension_ops else 0.35
        shared = sorted(set(tension_ops) & set(lens["operators"]))
        freshness = 0.0 if lens["id"] in recent_set else 0.18
        ucb = ucb_exploration_bonus(BAND_SERENDIPITY, lens["default_move"], region_counts)
        score = 0.42 * d_dom + 0.38 * op_sim + freshness + 0.35 * ucb
        scored_lenses.append((score, lens, d_dom, shared))

    scored_lenses.sort(key=lambda item: item[0], reverse=True)

    # Greedy selection enforcing move diversity across A, B, C, D
    selected: List[Dict[str, Any]] = []
    used_moves: Set[str] = set()
    used_ids: Set[str] = set()

    # Pass 1: try to cover distinct default moves first among top candidates
    for score, lens, d_dom, shared in scored_lenses:
        if len(selected) >= n_lenses:
            break
        if lens["default_move"] not in used_moves:
            used_moves.add(lens["default_move"])
            used_ids.add(lens["id"])
            selected.append({
                "lens_id": lens["id"],
                "orthogonal_domain": lens["domain"],
                "assigned_move": lens["default_move"],
                "move_name": MOVE_NAMES[lens["default_move"]],
                "seed_mechanisms": lens["mechanisms"],
                "domain_separation": round(d_dom, 3),
                "bridged_operators": shared,
                "selection_score": round(score, 3),
            })

    # Pass 2: fill remaining slots with highest-scoring unused lenses
    for score, lens, d_dom, shared in scored_lenses:
        if len(selected) >= n_lenses:
            break
        if lens["id"] in used_ids:
            continue
        # Assign any still-uncovered move if possible
        missing_moves = [m for m in MOVES if m not in used_moves]
        move = missing_moves[0] if missing_moves else lens["default_move"]
        used_moves.add(move)
        used_ids.add(lens["id"])
        selected.append({
            "lens_id": lens["id"],
            "orthogonal_domain": lens["domain"],
            "assigned_move": move,
            "move_name": MOVE_NAMES[move],
            "seed_mechanisms": lens["mechanisms"],
            "domain_separation": round(d_dom, 3),
            "bridged_operators": shared,
            "selection_score": round(score, 3),
        })

    # Record selected lenses in rolling freshness memory
    state["recent_lenses"] = (state.get("recent_lenses", []) + [x["lens_id"] for x in selected])[-16:]
    save_steering_state(state)

    # Timeline Collision: search past banked/active sparks for mid-distance mechanism resonance
    collisions = find_timeline_collisions(full_tension, sparks, limit=3)

    return {
        "core_tension": core_tension.strip(),
        "source_domain": source_domain.strip(),
        "detected_operators": sorted(tension_ops.keys()),
        "recommended_lenses": selected,
        "timeline_collisions": collisions,
        "blinded_subagent_rule": (
            "Pass ONLY `core_tension`, `constraints_or_assumptions`, `orthogonal_domain`, and `assigned_move` "
            "to each parallel subagent. Never pass workspace filenames or industry nouns."
        ),
        "steering_snapshot": {
            "weights": state["weights"],
            "band_center": state["band"]["c"],
            "total_stored_sparks": len(sparks),
            "outcomes_recorded": len(state.get("outcomes", [])),
        },
    }


def find_timeline_collisions(
    query_tension: str,
    sparks: List[Dict[str, Any]],
    limit: int = 5,
) -> List[Dict[str, Any]]:
    """Surface dormant/past sparks whose abstract mechanism or trigger collides with query_tension."""
    hits: List[Tuple[float, Dict[str, Any], List[str]]] = []
    for sp in sparks:
        if sp.get("status") == "dismissed":
            continue
        blob = " ".join(
            str(sp.get(k, ""))
            for k in ("mechanism", "why_surprising", "revisit_when")
        )
        s_mech, shared_ops = mechanism_isomorphism(query_tension, blob)
        trig = str(sp.get("revisit_when", ""))
        trig_sim = cosine_sim(hashed_ngram_vec(query_tension), hashed_ngram_vec(trig)) if trig else 0.0
        resonance = max(s_mech, 0.55 * s_mech + 0.45 * trig_sim)
        if resonance >= 0.22 or len(shared_ops) >= 2:
            hits.append((resonance, sp, shared_ops))

    hits.sort(key=lambda x: x[0], reverse=True)
    out = []
    for res, sp, shared_ops in hits[:limit]:
        out.append({
            "id": sp.get("id"),
            "mechanism": sp.get("mechanism"),
            "why_surprising": sp.get("why_surprising"),
            "revisit_when": sp.get("revisit_when", ""),
            "move": sp.get("move", "B"),
            "status": sp.get("status", "banked"),
            "source_field": sp.get("source_field", ""),
            "resonance": round(res, 3),
            "shared_operators": shared_ops,
        })
    return out


# ---------------------------------------------------------------------------
# Tool 2: Evaluate Candidate Sparks, Detect Independent Convergence & Rank
# ---------------------------------------------------------------------------

def evaluate_sparks(
    core_tension: str,
    source_domain: str,
    candidates: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("candidates must be a non-empty list of lens spark objects.")

    state = load_steering_state()
    existing_sparks = load_sparks()
    weights = state["weights"]
    type_mult = state["type_mult"]
    band_cfg = state["band"]
    region_counts = state.get("region_counts", {})

    scored: List[Dict[str, Any]] = []
    mech_texts: List[str] = []

    for idx, raw in enumerate(candidates):
        title = str(raw.get("title") or f"Candidate {idx + 1}").strip()
        lens_domain = str(raw.get("lens_domain") or raw.get("orthogonal_domain") or "Orthogonal Lens").strip()
        claimed_move = str(raw.get("move") or "B").strip().upper()
        if claimed_move not in MOVES:
            claimed_move = "B"

        src_mech = str(raw.get("source_mechanism") or "").strip()
        transfer = str(raw.get("transfer_hypothesis") or "").strip()
        first_test = str(raw.get("first_test") or "").strip()
        combined_mech = f"{title}. {src_mech} {transfer}".strip()
        mech_texts.append(combined_mech)

        geom = serendipity_distance(source_domain, lens_domain, core_tension, combined_mech)
        d = geom["distance"]
        band = classify_band(d, band_cfg)

        # BridgeShape claim-integrity check without exclusion:
        # A 'Bridge' (B) requires cross-domain distance >= tau_lo; retype if too-close.
        effective_move = claimed_move
        retyped_from: Optional[str] = None
        if claimed_move == "B" and band == BAND_TOO_CLOSE:
            effective_move = "A"
            retyped_from = "B"

        surprise = _clamp((float(raw.get("surprise", 3)) - 1.0) / 4.0, 0.0, 1.0)
        leverage = _clamp((float(raw.get("leverage", 3)) - 1.0) / 4.0, 0.0, 1.0)
        nov, nearest_id = corpus_novelty(combined_mech, existing_sparks)
        g_d = g_dist(d, band_cfg)

        effort_key = str(raw.get("effort") or "med").strip().lower()
        effort_w = EFFORT_WEIGHTS.get(effort_key, 2.0)

        bracket = (
            weights["dist"] * g_d
            + weights["surp"] * surprise
            + weights["lev"] * leverage
            + weights["nov"] * nov
        )
        t_mult = type_mult.get(effective_move, 1.0)
        val_score = _clamp(t_mult * bracket, 0.0, 1.0)
        explore_bonus = ucb_exploration_bonus(band, effective_move, region_counts)
        acq_score = val_score + explore_bonus
        rank_score = val_score / effort_w

        scored.append({
            "index": idx,
            "title": title,
            "lens_domain": lens_domain,
            "move": effective_move,
            "move_name": MOVE_NAMES[effective_move],
            "retyped_from": retyped_from,
            "distance": d,
            "d_domain": geom["d_domain"],
            "s_mechanism": geom["s_mechanism"],
            "distance_band": band,
            "g_dist": round(g_d, 4),
            "shared_operators": geom["shared_operators"],
            "novelty": round(nov, 3),
            "nearest_existing_spark": nearest_id if nov < 0.45 else None,
            "value_score": round(val_score, 4),
            "rank_score": round(rank_score, 4),
            "acquisition_score": round(acq_score, 4),
            "effort": effort_key,
            "epistemic_status": str(raw.get("epistemic_status") or "hypothesis"),
            "source_mechanism": src_mech,
            "transfer_hypothesis": transfer,
            "first_test": first_test,
            "convergent": False,
        })

    # Detect True Independent Convergence across DISTINCT orthogonal lens domains.
    # Two guards prevent false convergence:
    #   1. Echo-chamber candidates (`too-close` to source_domain) cannot anchor a cross-domain convergence.
    #   2. Problem-statement words (`core_tension`) are stripped before comparing mechanisms, so two
    #      lenses only converge when they independently hit the SAME SOLUTION MECHANISM, never merely
    #      because both restated the problem prompt.
    tension_stems = {_stem_lite(tok) for tok in tokenize(core_tension)}

    def _solution_only_text(idx_c: int) -> str:
        raw_sol = f"{scored[idx_c]['title']} {scored[idx_c]['source_mechanism']} {scored[idx_c]['transfer_hypothesis']}"
        kept = [tok for tok in tokenize(raw_sol) if _stem_lite(tok) not in tension_stems]
        return " ".join(kept)

    sol_texts = [_solution_only_text(i) for i in range(len(scored))]

    n = len(scored)
    adj: Dict[int, Set[int]] = {i: set() for i in range(n)}
    pair_ops: Dict[Tuple[int, int], List[str]] = {}

    for i in range(n):
        if scored[i]["distance_band"] == BAND_TOO_CLOSE:
            continue
        for j in range(i + 1, n):
            if scored[j]["distance_band"] == BAND_TOO_CLOSE:
                continue
            # Same lens agreeing with itself is redundancy, NEVER convergence
            if domain_separation(scored[i]["lens_domain"], scored[j]["lens_domain"]) < 0.25:
                continue
            # Compare solution-only mechanisms (problem prompt stripped)
            s_i, s_j = sol_texts[i], sol_texts[j]
            if not s_i or not s_j:
                continue
            sim, shared = mechanism_isomorphism(s_i, s_j)
            lex = cosine_sim(hashed_ngram_vec(s_i), hashed_ngram_vec(s_j))
            if lex >= 0.26 or (sim >= 0.52 and lex >= 0.14) or (len(shared) >= 2 and lex >= 0.18):
                adj[i].add(j)
                adj[j].add(i)
                pair_ops[(i, j)] = shared

    convergences: List[Dict[str, Any]] = []
    visited: Set[int] = set()
    for start in range(n):
        if start in visited or not adj[start]:
            continue
        comp: List[int] = []
        queue = [start]
        visited.add(start)
        while queue:
            cur = queue.pop(0)
            comp.append(cur)
            for nb in adj[cur]:
                if nb not in visited:
                    visited.add(nb)
                    queue.append(nb)
        distinct_domains = sorted({scored[k]["lens_domain"] for k in comp})
        if len(distinct_domains) >= 2:
            union_ops: Set[str] = set()
            for a_idx in comp:
                for b_idx in comp:
                    if a_idx < b_idx and (a_idx, b_idx) in pair_ops:
                        union_ops.update(pair_ops[(a_idx, b_idx)])
                scored[a_idx]["convergent"] = True
            convergences.append({
                "member_indices": sorted(comp),
                "member_titles": [scored[k]["title"] for k in sorted(comp)],
                "distinct_lenses": distinct_domains,
                "lens_count": len(distinct_domains),
                "shared_operators": sorted(union_ops),
            })

    # Sort: convergent candidates first (Priority 1 override), then rank_score, then value_score
    ranked = sorted(
        scored,
        key=lambda item: (
            1 if item["convergent"] else 0,
            item["rank_score"],
            item["value_score"],
        ),
        reverse=True,
    )

    return {
        "convergence_detected": len(convergences) > 0,
        "convergences": convergences,
        "ranked_sparks": ranked,
        "band_summary": {
            BAND_SERENDIPITY: sum(1 for x in ranked if x["distance_band"] == BAND_SERENDIPITY),
            BAND_TOO_CLOSE: sum(1 for x in ranked if x["distance_band"] == BAND_TOO_CLOSE),
            BAND_TOO_FAR: sum(1 for x in ranked if x["distance_band"] == BAND_TOO_FAR),
        },
    }


# ---------------------------------------------------------------------------
# Tool 3: Capture a Distilled Mechanism Spark (1-Step, Domain-Neutral)
# ---------------------------------------------------------------------------

def capture_spark(
    mechanism: str,
    why_surprising: str,
    move: str = "A",
    revisit_when: str = "",
    source_field: str = "",
    first_test: str = "",
    surprise: int = 4,
    leverage: int = 4,
    effort: str = "low",
    capture_mode: str = "ambient",
    status: str = "banked",
    workspace_hint: str = "",
    distance: Optional[float] = None,
) -> Dict[str, Any]:
    mech_clean = (mechanism or "").strip()
    why_clean = (why_surprising or "").strip()
    if not mech_clean:
        raise ValueError("mechanism is required (1-2 domain-neutral sentences).")
    if not why_clean:
        raise ValueError("why_surprising is required.")

    move_up = (move or "A").strip().upper()
    if move_up not in MOVES:
        move_up = "A"

    status_clean = (status or "banked").strip().lower()
    if status_clean not in ("banked", "active", "pursued", "shipped"):
        status_clean = "banked"

    sparks = load_sparks()
    state = load_steering_state()

    # Near-duplicate guard so repeated "spark" commands stay idempotent
    nov, nearest_id = corpus_novelty(f"{mech_clean} {why_clean}", sparks)
    if nov < 0.12 and nearest_id:
        existing = next((s for s in sparks if s.get("id") == nearest_id), None)
        if existing:
            return {"created": False, "deduplicated": True, "spark": existing}

    d_val = _clamp(float(distance), 0.0, 1.0) if distance is not None else state["band"]["c"]
    band = classify_band(d_val, state["band"])
    g_d = g_dist(d_val, state["band"])
    surp_norm = _clamp((int(surprise) - 1) / 4.0, 0.0, 1.0)
    lev_norm = _clamp((int(leverage) - 1) / 4.0, 0.0, 1.0)
    w = state["weights"]
    val_score = _clamp(
        state["type_mult"].get(move_up, 1.0)
        * (w["dist"] * g_d + w["surp"] * surp_norm + w["lev"] * lev_norm + w["nov"] * nov),
        0.0,
        1.0,
    )
    eff_key = (effort or "low").strip().lower()
    rank_score = val_score / EFFORT_WEIGHTS.get(eff_key, 1.0)

    today = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
    short_hex = uuid.uuid4().hex[:4].upper()
    spark_id = f"SPK-{today}-{short_hex}"

    # Sanitize workspace_hint to basename only (never store full user paths)
    ws_clean = Path(workspace_hint).name if workspace_hint else ""

    ops = sorted(extract_operators(f"{mech_clean} {why_clean} {revisit_when}").keys())
    now_iso = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

    record = {
        "id": spark_id,
        "mechanism": mech_clean,
        "why_surprising": why_clean,
        "move": move_up,
        "move_name": MOVE_NAMES[move_up],
        "revisit_when": (revisit_when or "").strip(),
        "source_field": (source_field or "").strip(),
        "first_test": (first_test or "").strip(),
        "operators": ops,
        "surprise": max(1, min(5, int(surprise))),
        "leverage": max(1, min(5, int(leverage))),
        "effort": eff_key,
        "distance": round(d_val, 4),
        "distance_band": band,
        "novelty_at_capture": round(nov, 3),
        "value_score": round(val_score, 4),
        "rank_score": round(rank_score, 4),
        "capture_mode": "scan" if capture_mode == "scan" else "ambient",
        "status": status_clean,
        "workspace_hint": ws_clean,
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    sparks.insert(0, record)
    save_sparks(sparks)

    # Update exploration region count
    rkey = f"{band}:{move_up}"
    state["region_counts"][rkey] = int(state["region_counts"].get(rkey, 0)) + 1
    save_steering_state(state)

    return {
        "created": True,
        "deduplicated": False,
        "spark": record,
        "store_count": len(sparks),
    }


# ---------------------------------------------------------------------------
# Tool 4: One-Word Feedback & Online Regularized Steering Refit
# ---------------------------------------------------------------------------

def _normalize_weights_with_floor(w: Dict[str, float], floor: float = GUARDRAILS["weight_floor"]) -> Dict[str, float]:
    keys = list(RATIFIED_WEIGHTS.keys())
    out = {k: max(floor, float(w.get(k, RATIFIED_WEIGHTS[k]))) for k in keys}
    for _ in range(10):
        total = sum(out.values())
        if abs(total - 1.0) < 1e-12:
            break
        free = [k for k in keys if out[k] > floor + 1e-12]
        if not free:
            out = {k: v / total for k, v in out.items()}
            break
        fixed_sum = (len(keys) - len(free)) * floor
        free_sum = sum(out[k] for k in free)
        scale = (1.0 - fixed_sum) / free_sum
        for k in free:
            out[k] *= scale
    return out


def _cap_weight_step(old_w: Dict[str, float], new_w: Dict[str, float], cap: float = GUARDRAILS["step_cap"]) -> Dict[str, float]:
    alpha = 1.0
    for k, old_v in old_w.items():
        diff = abs(new_w[k] - old_v)
        limit = cap * max(old_v, 0.05)
        if diff > limit and diff > 1e-12:
            alpha = min(alpha, limit / diff)
    return {k: round(old_w[k] * (1.0 - alpha) + new_w[k] * alpha, 6) for k in old_w}


def regularized_refit(outcomes: List[Dict[str, Any]], state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Legible L2-anchored gradient step on outcomes, respecting floors, step caps,
    and anti-collapse bounds on the serendipity distance center c in [0.35, 0.65].
    """
    n = len(outcomes)
    if n < GUARDRAILS["cold_start_k"]:
        return {"refitted": False, "reason": f"cold-start ({n}/{GUARDRAILS['cold_start_k']} outcomes)"}

    w_cur = dict(state["weights"])
    band = dict(state["band"])
    keys = list(RATIFIED_WEIGHTS.keys())
    grad = {k: 0.0 for k in keys}

    for item in outcomes:
        feats = item.get("features") or {}
        y = float(item.get("target", 0.0))
        y_hat = sum(w_cur[k] * float(feats.get(k, 0.5)) for k in keys)
        resid = y_hat - y
        for k in keys:
            grad[k] += (2.0 / n) * resid * float(feats.get(k, 0.5))

    w_raw = {}
    for k in keys:
        reg_grad = grad[k] + 2.0 * GUARDRAILS["shrinkage"] * (w_cur[k] - RATIFIED_WEIGHTS[k])
        w_raw[k] = w_cur[k] - GUARDRAILS["lr"] * reg_grad

    w_norm = _normalize_weights_with_floor(w_raw)
    w_next = _cap_weight_step(w_cur, w_norm)

    # Nudge type multipliers by lift relative to overall outcome mean
    overall_y = sum(float(o.get("target", 0.0)) for o in outcomes) / n
    by_move: Dict[str, List[float]] = {}
    for o in outcomes:
        mv = str(o.get("move", "B"))
        by_move.setdefault(mv, []).append(float(o.get("target", 0.0)))

    type_next = dict(state["type_mult"])
    for mv, vals in by_move.items():
        if mv not in RATIFIED_TYPE_MULT:
            continue
        cur = type_next.get(mv, RATIFIED_TYPE_MULT[mv])
        mean_mv = sum(vals) / len(vals)
        nxt = cur + 0.12 * (mean_mv - overall_y) + GUARDRAILS["shrinkage"] * (RATIFIED_TYPE_MULT[mv] - cur)
        nxt = min(cur * (1.0 + GUARDRAILS["step_cap"]), max(cur * (1.0 - GUARDRAILS["step_cap"]), nxt))
        type_next[mv] = round(max(GUARDRAILS["type_mult_floor"], nxt), 4)

    # Nudge band center c toward hit-weighted distance, strictly bounded in [0.35, 0.65]
    w_dist_sum = sum(float(o.get("target", 0.0)) for o in outcomes)
    if w_dist_sum > 1e-6:
        c_target = sum(float(o.get("target", 0.0)) * float(o.get("distance", 0.5)) for o in outcomes) / w_dist_sum
        c_cur = band["c"]
        c_nxt = c_cur + 0.15 * (c_target - c_cur) + GUARDRAILS["shrinkage"] * (RATIFIED_BAND["c"] - c_cur)
        band["c"] = round(_clamp(c_nxt, GUARDRAILS["band_c_min"], GUARDRAILS["band_c_max"]), 4)

    state["weights"] = w_next
    state["type_mult"] = type_next
    state["band"] = band
    return {
        "refitted": True,
        "outcomes_used": n,
        "weights": w_next,
        "type_mult": type_next,
        "band_center": band["c"],
    }


def record_feedback(spark_id: str, outcome: str, note: str = "") -> Dict[str, Any]:
    out_clean = (outcome or "").strip().lower()
    if out_clean not in ("pursued", "shipped", "banked", "dismissed"):
        raise ValueError("outcome must be one of: pursued, shipped, banked, dismissed.")

    sparks = load_sparks()
    target_spark = next((s for s in sparks if s.get("id") == spark_id), None)
    if target_spark is None:
        raise ValueError(f"Spark not found: {spark_id}")

    prev_status = target_spark.get("status", "banked")
    # Retroactive delayed-hit detection: a banked slow-burn that later gets pursued/shipped!
    effective_outcome = (
        "delayed"
        if prev_status == "banked" and out_clean in ("pursued", "shipped") and target_spark.get("feedback_count", 0) > 0
        else out_clean
    )
    if out_clean == "shipped":
        effective_outcome = "shipped"

    now_iso = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    target_spark["status"] = out_clean
    target_spark["updated_at"] = now_iso
    target_spark["feedback_count"] = int(target_spark.get("feedback_count", 0)) + 1
    if note:
        target_spark["note"] = note.strip()
    save_sparks(sparks)

    state = load_steering_state()
    d_val = float(target_spark.get("distance", 0.5))
    features = {
        "dist": round(g_dist(d_val, state["band"]), 4),
        "surp": round(_clamp((int(target_spark.get("surprise", 3)) - 1) / 4.0, 0.0, 1.0), 4),
        "lev": round(_clamp((int(target_spark.get("leverage", 3)) - 1) / 4.0, 0.0, 1.0), 4),
        "nov": float(target_spark.get("novelty_at_capture", 0.8)),
    }
    state.setdefault("outcomes", []).append({
        "spark_id": spark_id,
        "outcome": effective_outcome,
        "target": OUTCOME_VALUES[effective_outcome],
        "move": target_spark.get("move", "B"),
        "distance": d_val,
        "features": features,
        "recorded_at": now_iso,
    })

    refit_info = regularized_refit(state["outcomes"], state)
    save_steering_state(state)

    return {
        "spark_id": spark_id,
        "previous_status": prev_status,
        "new_status": out_clean,
        "effective_learning_signal": effective_outcome,
        "steering_update": refit_info,
    }


# ---------------------------------------------------------------------------
# Tool 5: Query, Collide, or Manage the Local Spark Log
# ---------------------------------------------------------------------------

def query_sparks(
    query_tension: str = "",
    status: str = "all",
    limit: int = 15,
    delete_id: str = "",
) -> Dict[str, Any]:
    sparks = load_sparks()
    if delete_id:
        before = len(sparks)
        sparks = [s for s in sparks if s.get("id") != delete_id]
        save_sparks(sparks)
        return {
            "deleted_id": delete_id,
            "removed": before - len(sparks),
            "remaining_count": len(sparks),
        }

    filtered = sparks
    if status and status != "all":
        filtered = [s for s in sparks if s.get("status") == status]

    limit = max(1, min(100, int(limit)))
    collisions = (
        find_timeline_collisions(query_tension.strip(), filtered, limit=limit)
        if query_tension and query_tension.strip()
        else []
    )

    by_status: Dict[str, int] = {}
    for s in sparks:
        st = str(s.get("status", "banked"))
        by_status[st] = by_status.get(st, 0) + 1

    state = load_steering_state()
    return {
        "total_sparks": len(sparks),
        "counts_by_status": by_status,
        "collisions": collisions,
        "sparks": filtered[:limit],
        "steering": {
            "weights": state["weights"],
            "type_mult": state["type_mult"],
            "band_center": state["band"]["c"],
            "outcomes_recorded": len(state.get("outcomes", [])),
        },
    }


# ---------------------------------------------------------------------------
# Unified Dispatcher (shared by MCP server and CLI)
# ---------------------------------------------------------------------------

def dispatch_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if name == "serendipity_plan_scan":
        return plan_scan(
            core_tension=str(args.get("core_tension", "")),
            source_domain=str(args.get("source_domain", "")),
            constraints_or_assumptions=args.get("constraints_or_assumptions"),
            n_lenses=int(args.get("n_lenses", 4)),
        )
    if name == "serendipity_evaluate_sparks":
        return evaluate_sparks(
            core_tension=str(args.get("core_tension", "")),
            source_domain=str(args.get("source_domain", "")),
            candidates=list(args.get("candidates") or []),
        )
    if name == "serendipity_capture_spark":
        return capture_spark(
            mechanism=str(args.get("mechanism", "")),
            why_surprising=str(args.get("why_surprising", "")),
            move=str(args.get("move", "A")),
            revisit_when=str(args.get("revisit_when", "")),
            source_field=str(args.get("source_field", "")),
            first_test=str(args.get("first_test", "")),
            surprise=int(args.get("surprise", 4)),
            leverage=int(args.get("leverage", 4)),
            effort=str(args.get("effort", "low")),
            capture_mode=str(args.get("capture_mode", "ambient")),
            status=str(args.get("status", "banked")),
            workspace_hint=str(args.get("workspace_hint", "")),
            distance=float(args["distance"]) if args.get("distance") is not None else None,
        )
    if name == "serendipity_record_feedback":
        return record_feedback(
            spark_id=str(args.get("spark_id", "")),
            outcome=str(args.get("outcome", "")),
            note=str(args.get("note", "")),
        )
    if name == "serendipity_query_sparks":
        return query_sparks(
            query_tension=str(args.get("query_tension", "")),
            status=str(args.get("status", "all")),
            limit=int(args.get("limit", 15)),
            delete_id=str(args.get("delete_id", "")),
        )
    raise ValueError(f"Unknown tool: {name}")
