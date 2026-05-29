---
name: serendipity-maximizer
description: "Adaptive multi-agent serendipity system. Activates a tailored set of discovery agents for any user based on their role and venture stage, surfaces cross-domain connections, detects convergence, and manages discoveries through a full lifecycle. TRIGGER on: 'serendipity scan', 'adjacent this', 'what am I missing', 'find connections', 'run the serendipity agent', 'what could connect here', or when a user pastes research notes asking for unexpected connections. Loads a content pack (the agent library + role-stage matrix) which can be domain-specific. Falls back to the bundled generic example pack if no custom pack is present."
---

# Serendipity Maximizer — Core Framework

This is the **open-core framework**: the machinery for running an adaptive multi-agent serendipity system. It is domain-agnostic. The actual agents and role mappings live in a **content pack** that this framework loads at runtime.

> Serendipity = prepared mind + controlled exposure to the unexpected.

## How content packs work

The framework reads two files from a content pack:
- `agent-library.md` — the full roster of available discovery agents
- `role-stage-matrix.md` — which agents activate for each role × stage

**Pack resolution order:**
1. A pack path provided by the user this session ("use my Catalina pack at ...")
2. A `content-pack/` directory adjacent to this skill
3. The bundled `examples/generic-pack/` (a fictional company — always present)

The framework never hardcodes domain content. If you find yourself about to reference a specific company, product, or industry in this file, it belongs in a pack instead.

---

## Step 1: Intake protocol

Maximum 3 questions. Stop as soon as you have what you need.

```
Q1 (if role unknown):  "What's your role on the team?"
Q2 (if stage unknown): "What stage is the venture at? 
                        [Pre-seed / Seed / Series A / Series B / Revenue]"
Q3 (always):           "What's the focus for this session — 
                        what question or challenge are you working on?"
```

**After Q1 + Q2 — agent declaration + availability panel (always show this):**

---
**Selected for [role] · [stage]:**
| # | Agent | Domain |
|---|-------|--------|
| ● | [Agent name] | [one-line domain description] |
| ... 5 rows ... |

**Also available (not selected):**
[Agent name] · [tag] — [8-word max description]
... (all non-selected agents from the loaded pack) ...

*Would you like to add or swap any agents before we run? Name one or more, or say "looks good" to proceed.*

---

If the user swaps/adds: update the active set, confirm, then ask Q3.
If the user says "looks good": proceed to Q3.

**Context shortcuts** — skip Q1/Q2 when a prior registry, a stored user profile, or a strong domain signal in the question makes role/stage already known. Confirm inline rather than asking.

---

## Step 2: Agent selection

Read the loaded pack's `role-stage-matrix.md`. Select the agents for the declared role + stage. If the role isn't in the matrix, reason from the agent library: which agents would generate the most serendipitous, actionable discoveries for this person's work at this stage? State one sentence of reasoning per agent.

Apply any calibration directives that exist for this user before running.

---

## Step 3: Run the session

### Discovery type taxonomy

| Type | Name | Signal | Action |
|------|------|--------|--------|
| A | Anomaly | Doesn't fit the expected pattern | Investigate the outlier |
| B | Bridge | Two domains point at the same mechanism | Document + seek third confirmation |
| C | Constraint flip | Limitation in X becomes a feature in Y | Prototype immediately |
| D | Scale shift | Phenomenon has an analog at another scale | Find the underlying mechanism |

### Priority scoring

```
Priority = (Impact × Serendipity_Potential) ÷ Effort_weight
Impact: 1–10 | Serendipity_Potential: 1–10 | Effort_weight: Low=1, Med=2, High=4
```

### Epistemic confidence markers (required on every factual claim)

`[known]` `[hypothesis]` `[verify]` `[check: <term>]`

Use web search to resolve `[verify]` claims before outputting when possible.

### Execution

Run all selected agents in parallel against the session focus. Each agent uses its domain lens from the loaded pack, adjusted by any active calibration directive.

---

## Step 4: Convergence detection (never skip)

After all agents run: are 3+ pointing at the same underlying insight from different domains?

**Yes** → `## CONVERGENCE DETECTED` callout. Override all other priority scores. Priority 1.
**No** → State briefly. Move on.

---

## Step 5: Output

```markdown
## Session context
Role: [role] | Stage: [stage] | Pack: [pack name] | Agents: [list]
Calibration directives applied: [or "first session"]

## Project summary
[3–5 sentences]

## Adjacent possibles
[4–7 items. Each: title, Type label, confidence markers, 2–4 sentences]

## Cross-project collisions
[Connections to the user's other ventures, if any are known. "None" is valid.]

## Convergence check
[CONVERGENCE DETECTED callout OR "No convergence this session."]

## Ranked recommendations
[3–5 items by Priority Score. Specific and testable.]

## Weak signal log
Signal: [obs] | Why it matters: [1 sentence] | Revisit when: [trigger]

## Calibration data
[Per agent: hit rate estimate, novelty decay flag, type distribution]

## Next session seed
[2–3 sentences]
```

---

## Step 6: Calibration engine (runs after session)

A meta-agent that reads session output + registry, then writes focus directives for the next session and controls token cost.

### Quality metrics

| Metric | Threshold | Action |
|--------|-----------|--------|
| Hit rate | <30% | Redirect agent focus |
| Novelty decay | >70% similarity to prior 3 sessions | Force Type C or D only |
| Type distribution | Any type missing 3+ sessions | Mandate it |
| Cross-agent bridge rate | <1 bridge in 4 sessions | Boost interdisciplinary prompting |
| Time to action | >21 days | Likely wrong horizon — bank and redirect |

### Token efficiency controls (applied every session)

1. **Activation gating** — Suspend agents whose domain is premature for the stage. Record reactivation trigger.
2. **Context routing** — Each agent receives only registry entries tagged to its domain + recent convergence events.
3. **Tiered output depth** — Agents produce headline findings; expand only Priority > 15.
4. **Registry compression** — Periodically summarize old entries into domain themes.
5. **Prompt pruning** — Flag agent domain bullets with no high-priority appearances over many sessions.

### Stage transitions

The pack defines a stage table. Stage transitions are **declared by the user** — the calibration engine never infers them autonomously.

---

## Discovery lifecycle

Every discovery moves through:

```
New → Reviewing → Team Triage → Decision → Active → Banked
                                                       ↑
                              (reactivation trigger fires)
```

Banked ≠ discarded. Banked discoveries carry a reactivation trigger and wait. The calibration engine fires triggers when conditions are met. The discovery board (`app/discovery-board.jsx`) manages this lifecycle with persistent storage.

---

## Constraints

- Maximum 3 intake questions. Proceed after that.
- Never assume role or stage — confirm or ask.
- Never hardcode domain content in this file — it belongs in a pack.
- Convergence detection is not optional.
- Calibration token levers apply every session.
- Stage transitions: user declares, engine executes.
- End every session: "Which of these would you like to pursue or refine?"
