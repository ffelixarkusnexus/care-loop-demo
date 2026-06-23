# ADR 0012 — Scope, assumptions, and limitations (this is a ~1-day AI-native demo)

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

This repository is a small, real, public artifact built in about a day, AI-native — the implementation was
directed and every decision owned by the author, who also wrote the eleven preceding ADRs. It is scoped from a
public job description and a general read of how such behavioral-health platforms work. Its purpose is to
demonstrate **approach, architecture, and safety judgment** — and the ability to ramp into a new stack and ship
quickly — **not** to be a production clinical system, and not to imply years of tenure in this stack. The author
delivers in TypeScript / React / Next.js AI-native; Supabase was new at the start of this build.

Stating the edges explicitly is itself the point: a reviewer should be able to see exactly what was built, what
was deliberately left out, and what production would require — with no overclaiming.

## Decision

**In scope (built):** the four-phase orchestrator as a Supabase Edge Function; the deterministic safety gate;
the official risk tier computed in code; RLS tenant isolation proven by a cross-tenant test (in CI); structured,
zod-validated model output; a clinician triage dashboard and dual-pane review with human sign-off; an eval
harness over fixed scenarios; CI; audit logging; and one real end-to-end model run on synthetic data.

**Deliberately out of scope (and why):**

- A real clinical-instrument library — the demo uses one illustrative screener.
- EHR / FHIR integration and a richer, longitudinal patient/instrument model.
- Real notification delivery — simulated via an `alerts` row + badge ([ADR-0005](0005-scope-boundaries-and-deferred-features.md)).
- A hosted deployment — the app runs locally; hosting is a known, scoped follow-up.
- Anything touching real PHI — all data is synthetic.
- Clinically validated thresholds — they are illustrative only ([ADR-0008](0008-illustrative-non-clinical-thresholds.md)).

**What production-grade would require** (the roadmap, so the edges are explicit):

- Validate the screening instruments and every threshold with clinical experts — nothing here is clinically
  validated.
- Evaluate the safety gate beyond invariants: adversarial prompts + labeled data + human review. The banned
  lexicon and numeric checks are deliberately simple and necessarily incomplete
  ([ADR-0004](0004-reflection-gate-is-deterministic.md)).
- Enforce the audit log as append-only at the database level (trigger / revoked privileges), not only by policy
  ([ADR-0011](0011-audit-log-append-only-system-written.md)).
- Real authn/authz, clinical roles, provider–patient relationships, and consent — beyond the demo's
  clinician/member roles.
- EHR / FHIR integration; a richer, longitudinal patient and instrument model.
- Hosted deployment with BAAs, encryption-at-rest configuration, and the SOC 2 controls a HIPAA system needs.
- Scale + reliability for the model pipeline: queueing, idempotency/retries, rate-limiting, and observability
  (metrics/tracing/alerting) beyond the audit trail.
- Real notification delivery (Slack / Teams / email) — a small, known add.

## Consequences

- Every omission is a documented decision, not a blind spot; a reviewer can map demo → production directly.
- The safety posture holds within the demo's scope: the deterministic gate blocks on any detected violation, the
  model has no authority over what reaches a clinician, and the true fail-closed backstop is that **nothing
  reaches `final` without a human sign-off.**
- The production roadmap above is the revisit list; picking the project back up means selecting from it on a
  fresh branch.
