# ADR 0006 — Edge Function invocation and auth posture

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

The orchestrator runs as a Supabase Edge Function, invoked two ways: **on-demand** (a logged-in clinician hits
"Run workflow") and on a **schedule** (the daily monitor, with no user present).

## Decision

On-demand invocations **forward the user's JWT**, so RLS applies automatically and the function can only touch
that user's org. The scheduled run has no user, so it uses the **service role** — which bypasses RLS — and
therefore **must scope every query by `org_id` explicitly**, is limited to the monitoring read + workflow
enqueue, and writes an `audit_log` entry for each run.

## Options considered

1. **(Chosen) User-JWT for on-demand, service-role + explicit org-scoping for scheduled.**
2. **(Rejected) Service role everywhere** — discards RLS defense-in-depth on the interactive path and fails
   open on a query bug.
3. **(Rejected) No scheduled run** — loses the "daily monitoring engine" the workflow is meant to show.

## Consequences

The interactive path keeps RLS as a safety net; the scheduled path's elevated privilege is explicit, narrowly
scoped, and audited. The trade-off is documented, not hidden — see
[ADR-0003](0003-rls-for-tenant-isolation.md).
