# ADR 0011 — The audit log is append-only and system-written; users are read-only

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

Every workflow phase writes an `audit_log` event (who/what/when, ids only — ADR-0006). The audit trail is only
trustworthy if the actors it records cannot **forge or alter** it. If a clinician's JWT could insert, update, or
delete `audit_log` rows, the log would be operate-as-user — and a compromised or careless user session could
rewrite history. Integrity matters more here than letting writes run as the acting user.

## Decision

`audit_log` is **append-only, system-written, user-read-only (org-scoped):**

- **Reads:** an org-scoped `SELECT` policy lets a clinician read **their own org's** audit trail (and zero of
  another org's) — already enforced by `audit_log_select` (ADR-0003).
- **Writes:** there is **no** user `INSERT`/`UPDATE`/`DELETE` policy. With RLS enabled and no permissive write
  policy, every user write is denied by the database. Audit rows are written **only** on the elevated
  service-role path (the edge function's admin client, ADR-0006), so users can neither forge nor alter them.

## Options considered

1. **(Chosen) System-written via service role; users read-only, org-scoped.** Users cannot forge/alter audit
   rows; the trail is trustworthy and still inspectable by the right clinician.
2. **(Rejected) Add a user `INSERT` policy so audit writes run under the user JWT.** Operate-as-user; a user
   session could fabricate or spoof audit entries. Defeats the point of an audit log.
3. **(Rejected) No read access for users.** Loses a legitimate, useful capability (a clinician inspecting their
   org's trail) for no integrity gain.

## Consequences

- Tests assert a user can read their org's audit rows, reads **zero** of another org's, and **cannot** insert an
  `audit_log` row.
- The trade-off is explicit: audit integrity over operate-as-user.
- **Production hardening (deferred):** a `BEFORE UPDATE OR DELETE` trigger that raises on `audit_log`, so the
  append-only invariant holds even for the service role / DB admin — not just for users. Out of scope for the
  demo; noted so the gap is a decision, not an oversight.
