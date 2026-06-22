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

## Implementation note (Phase 2) — the helper recursion and the `SECURITY DEFINER` fix

The original sketch declared the membership helper `SECURITY INVOKER`:

```sql
create function app_user_orgs() ... security invoker as $$
  select org_id from memberships where user_id = auth.uid() $$;
```

Run against real Postgres, every tenant query failed with **`54001: stack depth limit exceeded`**. Cause:
`memberships` itself has RLS, and its policy is `org_id in (select app_user_orgs())`. With the helper running
as the *caller* (`security invoker`), reading `memberships` inside the helper re-triggers the `memberships`
policy, which calls the helper again — **infinite recursion**.

**Fix (chosen): make the helper `SECURITY DEFINER`** so it reads `memberships` as its owner, bypassing RLS
*inside the function only* and breaking the cycle. The effective isolation is unchanged — the function still
returns only the caller's orgs. It is **hardened**, because an unpinned `search_path` on a `SECURITY DEFINER`
function is a privilege-escalation vector:

```sql
create or replace function public.app_user_orgs()
  returns setof uuid language sql security definer
  set search_path = ''            -- pin: mandatory, not optional
  stable as $$
  select org_id from public.memberships where user_id = (select auth.uid())
$$;
```

- `set search_path = ''` + **every reference schema-qualified** (`public.memberships`, `auth.uid()`) closes the
  search-path attack surface.
- `(select auth.uid())` lets Postgres cache the value per statement.
- It is parameterless and filtered to `auth.uid()`, so `SECURITY DEFINER` exposes nothing across tenants.

**Why not the alternative** (`memberships` policy = `using (user_id = auth.uid())`, keeping the helper
`security invoker`): that restricts each user to *their own* membership row, but a clinician must read their
org-mates'/patients' membership rows within their org. So `memberships` stays org-scoped via the helper, and
`SECURITY DEFINER` is what makes that non-recursive.

Verified: `tests/rls.test.ts` (user A reads zero of org B's rows; anon reads zero) passes against the local
Supabase stack.

### Every `org_id` table is RLS-protected — no shared-catalog exception

build-brief §6 sketched RLS on a subset and omitted `screeners` / `screener_items`. That was reconciled to a
single rule: **every table that carries `org_id` is org-owned and gets RLS.** `screeners` is scoped by
`org_id`; `screener_items` has no `org_id`, so it scopes through its parent screener:

```sql
create policy screeners_select on screeners
  for select using (org_id in (select public.app_user_orgs()));
create policy screener_items_select on screener_items
  for select using (screener_id in (
    select id from public.screeners where org_id in (select public.app_user_orgs())
  ));
```

A screener catalog readable across tenants would be an isolation inconsistency (org-owned data leaking via a
table that simply wasn't in the original list), so it is **not** treated as a shared catalog. `tests/rls.test.ts`
proves a user in org A reads zero of org B's screeners and screener_items.
