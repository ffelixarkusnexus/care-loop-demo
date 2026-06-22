-- Phase 3 corrections (folded into PR #3 before merge).

-- 1) Safety-item designation comes from EXPLICIT SCHEMA, never inferred from prose
--    (ADR-0010). scoring.ts/reflect.ts already key escalation off is_safety_item;
--    this gives that flag a real, robust source.
alter table screener_items
  add column is_safety_item boolean not null default false;

-- 2) audit_log integrity (ADR-0011): append-only, system-written, users read-only.
--    The org-scoped SELECT policy and the absence of any user INSERT/UPDATE/DELETE
--    policy already shipped in 0001 (RLS denies writes with no permissive policy),
--    so there is nothing to add here — writes stay on the service-role path by
--    design. This block documents the invariant; production hardening would add a
--    DB trigger that blocks UPDATE/DELETE even for the service role (deferred).
