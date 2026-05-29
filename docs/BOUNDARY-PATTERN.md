# Pattern: Automated Open-Core Boundary Enforcement

A reusable organizational guardrail for any project that splits into a **public layer** and a **private layer** — open-source framework vs. proprietary content, published research vs. commercial IP, shared tooling vs. confidential strategy.

This document is venture-agnostic. It captures the pattern so it can be dropped into any repo where the cost of a leak is high and human vigilance alone isn't reliable.

## The problem it solves

When you maintain a public/private boundary by hand, every commit is a chance to leak. Reviewers miss things — not from carelessness but because a single domain term buried in an example or a comment doesn't trigger attention. The leak that shipped in this very framework's first build (a private pack name left in an example path like `"use my <CompanyName> pack at..."`) was missed by manual review and caught only by an automated scan. Humans guard intent; machines guard patterns. You want both.

## The principle (SRE applied to IP)

This is a Site Reliability Engineering idea applied to intellectual property: **make the safe path the default path, and make violations loud and automatic.** An SRE team doesn't rely on engineers remembering not to deploy on Fridays — they encode it. Here, you don't rely on yourself remembering not to leak — you encode the boundary as a check that runs on every commit.

The boundary becomes self-enforcing rather than vigilance-dependent. That distinction is the whole value: vigilance degrades under deadline pressure exactly when leaks are most likely.

## The mechanism

Three small pieces:

1. **A blocklist** (`.boundary-blocklist`) — the terms that must never cross from private to public. One per line, version-controlled, reviewable. This is the policy, stated explicitly.

2. **A scan script** (`scripts/check-boundary.sh`) — greps tracked/staged files against the blocklist, exits non-zero on any hit. Runs in under a second. Works standalone or in CI.

3. **A pre-commit hook** (`.githooks/pre-commit`) — runs the scan automatically before every commit. A violation blocks the commit with a clear message pointing at the offending line.

Enable the hook once per clone:
```bash
git config core.hooksPath .githooks
```

## Tuning the blocklist

The craft is in the blocklist. Two failure modes:

- **Too broad** → false positives on legitimate generic words. (Don't block "hull" if your generic example pack legitimately discusses boat hulls.)
- **Too narrow** → leaks slip through. (Block the company name, product names, and the distinctive domain terms that only appear in private context.)

Start specific (proper nouns, product names), then add domain terms only when they're distinctive enough to signal private content. Comment each section so a future contributor understands the intent.

## Where this pattern applies beyond software

The same structure generalizes to any venture maintaining a public/private split:

- **A research venture** publishing papers while protecting a commercial process — block the proprietary process names and reagent/parameter specifics from the public manuscript repo.
- **A hardware company** open-sourcing a reference design while keeping the production design private — block part numbers, supplier names, and tolerance specs.
- **A consulting or services firm** sharing a public methodology while protecting client specifics — block client names and engagement details.

In every case the artifact is the same: an explicit policy file, an automated scan, and a gate that runs by default. The boundary stops being a thing you remember and becomes a thing the system enforces.

## CI integration (optional)

Add to any CI pipeline as a required check:

```yaml
# .github/workflows/boundary.yml
name: boundary
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: chmod +x scripts/check-boundary.sh && ./scripts/check-boundary.sh --all
```

This makes the boundary enforceable even for contributors who didn't enable the local hook — the gate lives in CI where it can't be bypassed.
