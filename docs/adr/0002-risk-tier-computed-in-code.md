# ADR 0002 — The official risk tier is computed in code; the model only advises

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

The risk tier drives triage and escalation — a safety-critical value. If the model sets it, a
non-deterministic, possibly-wrong number is steering clinical priority.

## Decision

`scoring.ts` computes `risk_tier` deterministically from the screener scores. The model may return an advisory
`model_risk` only; the summary's prose must match the **code-computed** tier or it is blocked
([ADR-0004](0004-reflection-gate-is-deterministic.md)). Store both `risk_tier` (official) and `model_risk`
(advisory) and show the gap.

## Options considered

1. **(Chosen) Code computes, model advises.**
2. **(Rejected) Model computes the tier** — a non-deterministic safety-critical number, unreproducible and
   unauditable.

## Consequences

The authoritative number is reproducible and unit-tested; the model cannot move triage priority; disagreement
between code and model is visible, not silently resolved.
