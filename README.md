# Serendipity Maximizer (v2 Plugin)

> **Serendipity = Prepared Mind + Controlled Collision Across Mid-Distance Domains.**

A zero-friction AI agent plugin that operationalizes serendipitous discovery inside everyday engineering, research, and software work — with **zero static domain packs, zero intake questionnaires, zero triage bureaucracy, and zero cross-project context bleed**.

Most "brainstorming" prompts fail because searching in your own industry's vocabulary pulls the model straight into nearest-neighbor clichés, while generating multiple angles in a single prompt causes shared-context anchoring. **Serendipity Maximizer** breaks both traps structurally:

1. **De-Jargonize First**: Translates your specific bottleneck into a **domain-neutral structural tension** before searching, preventing echo-chamber clichés and ensuring nothing proprietary ever leaks across projects.
2. **Blinded Parallel Orthogonal Lenses**: Dynamically selects 4 orthogonal scientific, natural, operational, or craft domains at mid-distance and fans out **4 isolated parallel subagents** that never see your codebase or each other's outputs.
3. **True Independent Convergence**: Detects when 2+ independent orthogonal fields land on the *same* underlying mechanism — the highest-conviction signal in cross-domain discovery.
4. **Subtle Ambient "Prepared Mind" + Timeline Collisions**: Stays silent 99% of the time during normal work, offering a single quiet footer nudge only when a genuine anomaly or constraint flip strikes (`say "spark" to save`). Saved sparks store only the **abstracted mechanism** in `~/.gemini/serendipity/sparks.jsonl` (outside git) and automatically collide with future problems across your timeline.

---

## Plugin Bundle Structure

```text
serendipity-maximizer/
├── plugin.json                              # Plugin manifest + 3 starter prompts
├── mcp_config.json                          # Zero-dependency stdio MCP server config
├── assets/
│   └── logo.svg                             # Convergence spark icon
├── rules/
│   └── AGENTS.md                            # Subtle "Prepared Mind" ambient nudge & anti-bleed directives
├── agents/
│   └── orthogonal-lens.md                   # Blinded single-domain mechanism scout subagent
├── skills/
│   └── serendipity-maximizer/
│       ├── SKILL.md                         # Zero-question scan, one-word capture & collision workflow
│       └── references/
│           └── serendipity-mechanics.md     # Mid-distance geometry, BridgeShape retyping & UCB steering math
├── scripts/
│   ├── serendipity_engine.py                # Pure Python 3.9+ stdlib geometry, convergence & spark store
│   ├── serendipity_mcp_server.py            # JSON-RPC 2.0 stdio MCP server
│   └── serendipity_cli.py                   # Standalone CLI entrypoint
└── tests/
    └── test_serendipity_engine.py           # End-to-end geometry, steering & MCP protocol test suite
```

---

## How It Works in Daily Use

### 1. Deliberate Scan (*"What am I missing?" / "Flip this constraint"*)
Ask for unexpected angles on whatever file, equation, CAD model, or architecture you have open. No intake questions are asked:
- Your problem is distilled into a domain-neutral `core_tension`.
- `serendipity_plan_scan` selects 4 fresh orthogonal lenses spanning the 4 serendipity moves — **Anomaly (`A`)**, **Bridge (`B`)**, **Constraint Flip (`C`)**, and **Scale Shift (`D`)** — and checks your local spark log for timeline collisions.
- 4 blinded `orthogonal-lens` subagents run in parallel.
- `serendipity_evaluate_sparks` scores candidates on the asymmetric peaked mid-distance curve $g_{\text{dist}}(d)$, flags **`⬡ INDEPENDENT CONVERGENCE`** when distinct fields hit the same mechanism, and returns 3–4 immediately falsifiable sparks.

### 2. Ambient "Prepared Mind" Capture (*Zero-Effort Memory*)
When a test result violates an assumption or a constraint unexpectedly flips in your favor during ordinary work, the plugin appends one quiet line:
> `⚡ Spark worth banking? — [1-sentence domain-neutral mechanism] (say "spark" to save)`

Replying `"spark"` (or `"bank #2"` / `"pursue #1"` after a scan) logs the abstracted mechanism and a `revisit_when` trigger to `~/.gemini/serendipity/sparks.jsonl` in one step.

### 3. Adaptive Steering Without Echo-Chamber Collapse
Saying `"pursue"`, `"shipped"`, `"bank"`, or `"dismiss"` updates `~/.gemini/serendipity/steering.json` via an L2-regularized online fit with per-weight floors, step caps, retroactive slow-burn (`banked → pursued`) credit, and a UCB exploration bonus so the engine learns what resonates for you without ever collapsing into safe nearest-neighbor suggestions.

---

## Installation & Testing

### Install Globally in Antigravity
Copy or symlink into your global plugins directory and restart Antigravity:

```bash
ln -s "$(pwd)" ~/.gemini/config/plugins/serendipity-maximizer
```

### Run the Test Suite (Zero Dependencies — Python 3.9+ Stdlib Only)
```bash
python3 -m unittest discover -s tests -v
```

---

## License

MIT — see [LICENSE](./LICENSE).
