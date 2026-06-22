# ADR 0001 — Structured tool-use output over free text

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

The LLM features produce content used downstream — stored, displayed, validated. Free text (or JSON embedded
in prose) invites prompt-injection, hallucinated/extra fields, and is unauditable; you cannot reliably recover
intent by parsing prose.

## Decision

The model answers **only** by calling a single tool whose `input_schema` mirrors a zod schema (forced
`tool_choice`). Every tool output is `safeParse`d before any use; invalid → `needs_manual_review`. The model
emits **structure, never prose-as-data**, and never raw SQL/HTML.

## Options considered

1. **(Chosen) Structured tool-use + zod validation.**
2. **(Rejected) Parse free-text / JSON-in-prose** — brittle and injectable.
3. **(Rejected) Trust the model to format consistently** — no guarantee, no audit trail.

## Consequences

Outputs are validatable, auditable, and testable; the model must satisfy a narrow contract or be rejected.
This is the foundation [ADR-0002](0002-risk-tier-computed-in-code.md) and
[ADR-0004](0004-reflection-gate-is-deterministic.md) build on.
