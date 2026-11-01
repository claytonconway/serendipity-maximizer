# Serendipity Geometry, Moves & Adaptive Steering Reference

## 1. Why De-Jargonization Comes First
Asking a model or search engine for ideas in raw domain vocabulary pulls answers toward the **nearest semantic neighbors** in the same industry (best practices and clichés). Worse, static "domain packs" leak vocabulary across projects.

Extracting the **domain-neutral structural tension** before spawning lenses accomplishes two invariants simultaneously:
1. **Zero Context Bleed**: Blinded subagents and `~/.gemini/serendipity/sparks.jsonl` never ingest proprietary names, paths, or project nouns.
2. **Structural Bridgeability**: Mechanisms from biology, horology, congestion control, acoustics, or metallurgy match on *shared physical/logical operators* rather than surface words.

---

## 2. Two-Axis Mid-Distance Geometry (`Similarity != Serendipity`)

A single raw text cosine distance conflates *"different industry"* with *"unrelated mechanism."* [`serendipity_engine.py`](../../../scripts/serendipity_engine.py) separates them explicitly:

- **Domain Separation** $d_{\text{domain}} \in [0, 1]$: Subword/stem cosine distance between `source_domain` and `lens_domain`.
- **Mechanism Isomorphism** $s_{\text{mechanism}} \in [0, 1]$: Overlap across the 16 universal structural operator axes (`thermal_phase`, `stiffness_compliance`, `flow_routing`, `feedback_control`, `surface_interface`, `scale_geometry`, `asymmetry_ratchet`, `signal_sparsity`, `energy_duty_cycle`, `fault_sacrificial`, `search_allocation`, `impedance_coupling`, `state_hysteresis`, `timing_entrainment`, `constraint_inversion`, `self_assembly`) blended with stem/ngram similarity.

The effective **Serendipity Distance** is:

$$d_{\text{raw}} = 0.5\,d_{\text{domain}} + 0.5\,(1 - s_{\text{mechanism}}), \qquad d = \begin{cases}\min(d_{\text{domain}},\, d_{\text{raw}}) & d_{\text{domain}} < \tau_{\text{lo}} \\ \operatorname{clamp}_{[0, 1]}(d_{\text{raw}}) & d_{\text{domain}} \ge \tau_{\text{lo}}\end{cases}$$

*(Echo-chamber guard: when $d_{\text{domain}} < \tau_{\text{lo}} = 0.30$, low mechanism overlap can never falsely push a same-domain idea up into `serendipity-band`.)*

| Regime | Typical $(d_{\text{domain}}, s_{\text{mechanism}})$ | Effective $d$ | Band | Asymmetric Peaked Curve $g_{\text{dist}}(d)$ |
| :--- | :--- | :--- | :--- | :--- |
| **Echo-Chamber Cliché** | $(0.10,\; 0.90)$ | $0.10$ | `too-close` ($< 0.30$) | Near floor $0.20$ (mildly useful, never excluded) |
| **Serendipitous Bridge** | $(0.90,\; 0.85)$ | $0.525$ | `serendipity-band` ($[0.30, 0.70]$) | Peaks at $1.00$ around $c = 0.50$ |
| **Random Non-Sequitur** | $(0.95,\; 0.05)$ | $0.95$ | `too-far` ($> 0.70$) | Far floor $0.15$ (penalized more than cliché, never excluded) |

$$g_{\text{dist}}(d) = \max\!\left(\text{floor}(d),\; \exp\!\left(-\frac{(d - c)^2}{2\sigma^2}\right)\right), \quad \text{floor}(d) = \begin{cases}0.20 & d \le c \\ 0.15 & d > c\end{cases}$$

---

## 3. Claim Integrity vs. Value Scoring (No Exclusion)
- **Hard Claim Integrity (`BridgeShape` retyping)**: If a candidate claims Move `B` (`Bridge`) while landing in `too-close` ($d < 0.30$), it is automatically retyped to Move `A` (`retyped_from: "B"`) — repairing the mislabeled bridge claim **without ever dropping the idea**.
- **Independent Convergence Override**: When $\ge 2$ blinded subagents operating in *distinct* orthogonal domains ($d_{\text{domain}} \ge 0.25$) independently arrive at the same underlying transfer mechanism, `evaluate_sparks` emits a **`CONVERGENCE`** cluster and promotes those sparks to the top of the ranking.

---

## 4. L2-Regularized Online Steering & Delayed-Hit Credit
Feedback recorded via `serendipity_record_feedback` updates `~/.gemini/serendipity/steering.json`:
- **Retroactive Slow-Burn Protection**: When a `banked` spark later transitions to `pursued` or `shipped`, it receives `delayed` / `shipped` positive target credit so the system never learns to punish slow-burn ideas.
- **Anti-Collapse Guardrails**:
  - Cold-start hold until $K \ge 10$ feedback events accumulate.
  - L2 shrinkage pulls `weights` and `type_mult` gently toward ratified priors (`dist=0.28, surp=0.27, lev=0.27, nov=0.18`; `TypeMult A=0.95` kept high for anomalies).
  - Per-weight floor ($\ge 0.05$), per-step movement cap ($\le 15\%$), and hard bounds on the distance peak $c \in [0.35, 0.65]$ alongside UCB exploration bonuses over `(band × move)` counts ensure the engine adapts to your taste without ever collapsing into repetitive nearest-neighbor suggestions.
