# Architecture Decision Records

The *why* behind every non-obvious decision in this repo. Each ADR records context, the options considered
(with why the rejected ones were rejected), and the consequences. Ratified ADRs are **superseded, never
rewritten**.

The two that best show the engineering judgment:

- **[ADR-0004](0004-reflection-gate-is-deterministic.md)** — the deterministic patient-safety gate: why the
  model is given no authority over what reaches a clinician.
- **[ADR-0007](0007-shared-core-across-deno-node-boundary.md)** — the Deno/Node runtime boundary: why one
  shared source of truth, and why the harder edge-function path was chosen deliberately.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-structured-output-over-freetext.md) | Structured tool-use output over free text | Accepted |
| [0002](0002-risk-tier-computed-in-code.md) | Official risk tier computed in code; model only advises | Accepted |
| [0003](0003-rls-for-tenant-isolation.md) | Tenant isolation via Row-Level Security in the database | Accepted |
| [0004](0004-reflection-gate-is-deterministic.md) | The patient-safety gate is deterministic | Accepted |
| [0005](0005-scope-boundaries-and-deferred-features.md) | Scope boundaries and deferred features | Accepted |
| [0006](0006-edge-function-and-auth-posture.md) | Edge Function invocation and auth posture | Accepted |
| [0007](0007-shared-core-across-deno-node-boundary.md) | Shared pure-logic core across the Deno/Node boundary | Accepted |
| [0008](0008-illustrative-non-clinical-thresholds.md) | Scoring/safety thresholds are illustrative, non-clinical defaults | Accepted |
