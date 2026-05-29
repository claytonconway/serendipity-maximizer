# Serendipity Maximizer

An open framework for operationalizing serendipity in early-stage hardware and research ventures.

> Serendipity = prepared mind + controlled exposure to the unexpected.

Most "brainstorming" tools generate undifferentiated ideas. This framework does something different: it runs a tailored set of specialist discovery agents — each with a distinct domain lens — selected automatically based on **who you are** (your role) and **where the venture is** (its stage). It detects when multiple agents converge on the same insight, scores discoveries for priority, calibrates itself over time, and manages every discovery through a full lifecycle from capture to decision.

## Open core + content packs

This repo is the **framework** — the machinery. It's domain-agnostic. The actual agents and role mappings live in a **content pack** that the framework loads at runtime.

- **This repo (public):** workflow, discovery taxonomy, scoring, convergence detection, calibration engine, lifecycle, discovery board UI, and a fully worked generic example pack (fictional robotics company).
- **Your content pack (private):** your industry's actual agents, your role-stage mappings, your discoveries.

This separation lets you share the methodology while keeping your strategic domain knowledge private.

## Quick start

1. Install `skill/` as a Claude skill (works in Chat and Cowork)
2. The framework loads `examples/generic-pack/` by default — try it immediately
3. To use your own domain: copy the generic pack, edit the agents and matrix, and point the framework at it
4. Open `app/discovery-board.jsx` as a React artifact to manage discoveries

## What's in the box

```
skill/
  SKILL.md                          # The framework: intake, workflow, calibration
examples/generic-pack/
  agent-library.md                  # 14 example agents (fictional robotics co.)
  role-stage-matrix.md              # Example role × stage mappings
app/
  discovery-board.jsx               # Persistent discovery lifecycle board
docs/
  architecture.html                 # System architecture diagram
  role-matrix.html                  # Interactive role × stage explorer
PACK-GUIDE.md                       # How to author your own content pack
```

## Core concepts

**Discovery types** — Every finding is tagged: Anomaly (A), Bridge (B), Constraint flip (C), or Scale shift (D). Each type implies a different next action.

**Priority score** — `(Impact × Serendipity_Potential) ÷ Effort_weight`. Turns four fuzzy dimensions into one ranked list.

**Convergence detection** — When 3+ agents independently point at the same insight, that's the highest-value signal. It overrides individual scores.

**Calibration engine** — A meta-agent that scores each agent's hit rate, novelty, and bridge rate over time, writes focus directives for the next session, and controls token cost through activation gating, context routing, and output tiering.

**Discovery lifecycle** — `New → Reviewing → Team Triage → Decision → Active → Banked`. Banked discoveries aren't discarded; they carry a reactivation trigger and wait for the right moment.

## Building your own content pack

See [PACK-GUIDE.md](./PACK-GUIDE.md). In short: copy `examples/generic-pack/`, replace the agent domain lenses with your industry's knowledge areas, keep the metadata structure, and adjust the role-stage matrix to your org.

## Origin

This framework began as a single-prompt agent and evolved through use into a multi-agent adaptive system. The open-core split was itself a discovery the system surfaced — that the framework is reusable methodology while the agent content is venture-specific IP.

## License

MIT — see [LICENSE](./LICENSE). Use it, fork it, build packs for your own domain.
