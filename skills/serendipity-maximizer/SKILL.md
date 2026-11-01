---
name: serendipity-maximizer
description: >-
  Zero-friction cross-domain serendipity engine. Activate whenever the user asks
  "what am I missing", "run a serendipity scan", "adjacent this", "flip this constraint",
  "find unexpected connections", "collide with my spark log", replies "spark" to save
  an ambient surprise, or gives one-word feedback ("pursue", "bank", "shipped", "dismiss")
  on a spark. Abstracts problems into domain-neutral tensions, fans out blinded parallel
  orthogonal-lens subagents, detects independent convergence, and manages the local spark log.
---

# Serendipity Maximizer (v2 — Zero-Friction Workflow)

> **Serendipity = Prepared Mind + Controlled Collision Across Mid-Distance Domains.**

Never ask role, org-chart, or funding-stage intake questions. Infer context directly from the user's open files, terminal state, or prompt, strip all industry jargon upfront so nothing leaks or anchors, and run the workflow below.

Prefer calling the bundled MCP tools (`serendipity_*` on `serendipity-maximizer-mcp`) or the zero-dependency CLI ([`serendipity_cli.py`](../../scripts/serendipity_cli.py)). For mathematical details of the distance geometry and adaptive steering loop, see [`serendipity-mechanics.md`](references/serendipity-mechanics.md).

---

## Mode 1: Deliberate Serendipity Scan ("What am I missing?" / "Flip this constraint")

### Step 1 — Abstract the Core Structural Tension (Zero Questions, Zero Jargon)
Read the relevant files or user message directly. Before searching or planning lenses, translate the specific problem into:
- **`core_tension`** *(1–3 sentences, strictly domain-neutral)*: Express the underlying physical, mathematical, informational, or geometric trade-off without any product names, filenames, or industry nouns.
  - *Bad (echo-chamber)*: `"Prevent cold-storage warehouse robot Li-ion battery drain while lifting pallets."`
  - *Good (structural)*: `"Sustain high intermittent mechanical power output across a 40°C thermal drop without adding parasitic insulation mass or continuous heater draw."`
- **`source_domain`**: A 2–4 word label of the user's current field (e.g., `"mobile robotics power"`, `"distributed database consensus"`) used strictly to push lenses *away* from the user's industry.
- **`constraints_or_assumptions`**: 2–3 annoying limits or unexamined assumptions currently treated as fixed.

### Step 2 — Plan Orthogonal Lenses & Check Timeline Collisions
Call `serendipity_plan_scan` (or `python3 scripts/serendipity_cli.py plan --json '...'`) with `core_tension`, `source_domain`, and `constraints_or_assumptions`.
- Review `recommended_lenses` (4 diverse fields spanning moves `A`, `B`, `C`, `D` with UCB exploration weighting) and any `timeline_collisions` surfaced from `~/.gemini/serendipity/sparks.jsonl`.
- You may swap at most 1 lens for a sharper bespoke orthogonal discipline if its domain separation from `source_domain` is clearly high.

### Step 3 — Fan Out 4 Blinded Parallel Subagents
Ensure the `orthogonal-lens` subagent is available (if not pre-registered, call `define_subagent` once using the prompt in [`orthogonal-lens.md`](../../agents/orthogonal-lens.md) with `EnableWriteTools: false`, `EnableMCPTools: false`, `EnableSubagentTools: false`).

Launch **all 4 `orthogonal-lens` subagents in parallel in the same turn** via `invoke_subagent`:
- Pass **only** `core_tension`, `constraints_or_assumptions`, that lens's `orthogonal_domain` (+ `seed_mechanisms`), and its `assigned_move`.
- **Never** pass workspace file paths, code snippets, or company/domain nouns to the subagents.
- End your turn after launching them if needed so all 4 execute concurrently without anchoring on each other.

### Step 4 — Evaluate Geometry, Detect Convergence & Map Back to Concrete Action
When the 4 subagents return:
1. Call `serendipity_evaluate_sparks` with `core_tension`, `source_domain`, and the collected `candidates`.
2. If a top candidate has `epistemic_status == "verify"`, run a quick `search_web` check to ground or qualify the mechanism (`[known]` vs. `[hypothesis]`).
3. Translate each top abstract `transfer_hypothesis` **back onto the user's real code/design/problem** with a concrete, falsifiable `first_test`.
4. Present a crisp, high-signal response (never a bloated corporate report):
   - **Core Tension**: 1–2 lines stating the abstracted trade-off.
   - **`⬡ INDEPENDENT CONVERGENCE`** *(include prominently at the top whenever `convergence_detected == true` — 2+ blinded orthogonal domains independently arrived at the same mechanism!)*
   - **`↺ TIMELINE COLLISION`** *(include if `timeline_collisions` surfaced a past banked spark from `~/.gemini/serendipity/sparks.jsonl`)*
   - **Top 3–4 Ranked Sparks**: For each spark, show:
     - **Title** · `[Move A/B/C/D]` · `[known]`/`[hypothesis]` · `VS <value_score>` (`<lens_domain>`)
     - **Why it works & how it maps here** (2–3 tight sentences).
     - **Smallest First Test**: Concrete experiment, calculation, or prototype step.
   - End with one low-friction line:
     *`Say "pursue #1", "bank #2" (saves the abstract mechanism to your spark log), or tell me which one to prototype.`*

---

## Mode 2: One-Word Ambient Capture ("spark" / "bank #N")

When the user replies `"spark"` to an ambient Prepared-Mind footer nudge, or says `"bank #2"` / `"pursue #1"` after a scan:
1. Strip all proprietary names, file paths, and industry nouns so the spark describes **only the reusable structural mechanism**.
2. Call `serendipity_capture_spark` (`status: "banked"` for `"spark"` / `"bank"`, or `status: "pursued"` for `"pursue"`). If updating an already-stored `SPK-...` ID, call `serendipity_record_feedback`.
3. Confirm in **one concise line** showing the saved ID (`SPK-...`), move type, and `revisit_when` trigger — zero extra questions.

---

## Mode 3: Collide or Browse the Spark Log

When the user asks *"collide my current problem with my spark log"* or *"show my banked sparks"*:
1. Call `serendipity_query_sparks` (passing `query_tension` if colliding against a current problem).
2. Highlight the highest-resonance mechanism bridges and how they apply to the current task. If the user wants a visual overview of a large spark log, you may render an inline interactive explorer via the `generative_ui` skill.
