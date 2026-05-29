# Role × Stage Matrix — Generic Example Pack

Worked example for the fictional *Meridian Robotics* (autonomous warehouse robots). Demonstrates the matrix format. Replace with your own.

Agent key (14 total):
01 Physics Bridge | 02 Regulatory/Safety | 03 Materials | 04 Demand Scanner
05 Mfg Tech | 06 Competitive Intel | 07 Capital & Funding | 08 Policy
09 Talent | 10 Supplier & Partner | 11 Config & Payload | 12 Operators
13 Platform & IP | 14 Org Systems & AI

First agent listed is the priority agent for that session.

---

## CEO / Founder
| Stage | Agents (priority first) |
|-------|------------------------|
| Pre-seed | 04, 06, 07, 13, 08 |
| Seed | 04, 06, 07, 13, 12 |
| Series A | 04, 06, 02, 13, 12 |
| Series B | 04, 06, 02, 13, 12 |
| Revenue | 04, 06, 08, 12, 13 |

## CTO / Chief Engineer
| Stage | Agents (priority first) |
|-------|------------------------|
| Pre-seed | 01, 03, 05, 14, 09 |
| Seed | 01, 03, 05, 14, 10 |
| Series A | 01, 03, 05, 11, 14 |
| Series B | 01, 02, 03, 05, 11 |
| Revenue | 01, 03, 05, 10, 11 |

## CFO
| Stage | Agents (priority first) |
|-------|------------------------|
| Pre-seed | 04, 06, 07, 08, 13 |
| Seed | 04, 06, 07, 13, 12 |
| Series A | 04, 06, 07, 13, 12 |
| Series B | 04, 06, 07, 13, 12 |
| Revenue | 04, 06, 07, 08, 12 |

## VP Business Development
| Stage | Agents (priority first) |
|-------|------------------------|
| Pre-seed | 04, 06, 08, 12, 09 |
| Seed | 04, 06, 13, 11, 12 |
| Series A | 04, 06, 13, 11, 12 |
| Series B | 04, 06, 13, 11, 12 |
| Revenue | 04, 06, 08, 11, 12 |

## VP R&D
| Stage | Agents (priority first) |
|-------|------------------------|
| Pre-seed | 14, 13, 01, 03, 05 |
| Seed | 14, 13, 01, 03, 07 |
| Series A | 01, 14, 02, 13, 03 |
| Series B | 01, 02, 03, 13, 14 |
| Revenue | 01, 03, 14, 13, 10 |

## Program Manager
| Stage | Agents (priority first) |
|-------|------------------------|
| Pre-seed | 02, 05, 08, 09, 10 |
| Seed | 02, 05, 08, 10, 11 |
| Series A | 02, 05, 08, 10, 11 |
| Series B | 01, 02, 05, 10, 11 |
| Revenue | 01, 02, 05, 10, 11 |

---

## Unlisted roles — reasoning guide

For any role not in this matrix, select 5 agents using this logic:
1. What does this person deliver? (drives which discovery is actionable)
2. What would surprise them most usefully?
3. What's the biggest risk in their domain right now?
4. Are they customer-facing (04, 06, 12) or technical (01, 03, 05, 14)?
5. What stage is the venture? (early = discovery-weighted; late = execution-weighted)

Always state the reasoning when selecting for an unlisted role.

---

## Stage table (for the calibration engine)

| Stage | Demand priority | Mfg Tech mode | Output depth | Compression trigger |
|-------|----------------|---------------|--------------|--------------------|
| Pre-seed | Highest | Tech scouting | Headline | 10 sessions |
| Seed | High | Tech scouting + partnerships | Headline + selective | 8 sessions |
| Series A | High | Tech scouting + supplier qual | Expand technical agents | 8 sessions |
| Series B | Medium | Production readiness | Full | 6 sessions |
| Revenue | Lower | Production active | Full | 5 sessions |
