# Content Pack Authoring Guide

A content pack teaches the framework about your domain. It's two files.

## File 1: `agent-library.md`

Define your roster of discovery agents. The framework selects 5 per session, so a roster of 10–16 gives good coverage. Each agent needs this structure:

```markdown
## Agent NN — [Name]
**Tag:** [short label] | **Primary type:** [A/B/C/D] | **Token tier:** [Low/Medium/High]

**Domain lens**
- [knowledge area this agent scans]
- [another — include cross-domain analogs, that's where bridges come from]

**Serendipity targets**
- [Type X: the kind of discovery this agent is hunting]

**Best for roles:** [roles this agent suits]
**Stage relevance:** [which stages]
```

**What makes a good agent:**
- A *distinct vantage point* no other agent shares — not a department, a lens
- Cross-domain reach built into the domain lens (the gannet-to-hull-design kind of leap)
- A clear primary discovery type so the calibration engine can track type distribution

**Token tier** tells the calibration engine how expensive the agent is to run, which informs activation gating.

## File 2: `role-stage-matrix.md`

Map each role × stage to 5 agents (priority agent first). Include:
- A table per role with a row per stage
- An "unlisted roles" reasoning guide for roles you didn't enumerate
- A stage table the calibration engine uses for activation gating and compression cadence

## Pointing the framework at your pack

Three ways, in resolution order:
1. Tell Claude in-session: "Use my pack at `path/to/pack/`"
2. Place your pack in a `content-pack/` directory next to the skill
3. Default: the bundled `examples/generic-pack/`

## Keeping your pack private

If your agents encode competitive strategy, keep the pack in a private repo. A common setup:
- Public: this framework (forked or referenced)
- Private: `your-company-pack/` with your agents, matrix, and registry

The framework never writes domain content back into itself, so the boundary stays clean.

## Registry and discoveries

Discoveries and calibration directives are runtime data, not pack content. Keep them out of both repos (the framework's `.gitignore` already excludes `*-registry.md` and `focus-directives.md`). Store them in the discovery board, a private notes vault, or a private data repo.
