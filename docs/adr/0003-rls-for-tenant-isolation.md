# ADR 0003 — Tenant isolation via Row-Level Security in the database, not the app

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

Multi-tenant, PHI-like data. App-layer filtering (`where org_id = …`) fails **open** the first time someone
forgets a clause — and that's a cross-tenant data breach.

## Decision

Enable **RLS** on every table; policies scope reads/writes to the caller's orgs via `app_user_orgs()`.
Isolation is enforced by the database regardless of app bugs. `tests/rls.test.ts` must prove a user in org A
reads **zero** of org B's rows.

## Options considered

1. **(Chosen) RLS in the DB.**
2. **(Rejected) App-layer filtering only** — one missing filter = a breach; fails open; not provable.

## Consequences

Isolation holds even with app bugs and is provable by test. The scheduled/service-role path bypasses RLS, so
it must scope `org_id` explicitly — see [ADR-0006](0006-edge-function-and-auth-posture.md).
