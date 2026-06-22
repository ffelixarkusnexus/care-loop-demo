# ADR 0009 — Dependency-inject the model client; keep the API key out of tests/CI

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

The orchestrator makes two Anthropic calls (assessment, summary). If the pipeline imported the
Anthropic SDK and read `ANTHROPIC_API_KEY` directly, three problems follow: (1) the shared core would no
longer be pure (it would touch a runtime API and the network), breaking the single-source/edge-import rule
([ADR-0007](0007-shared-core-across-deno-node-boundary.md)); (2) tests, the eval, and CI could not run without a
real key and would make non-deterministic, paid network calls; (3) a secret would be a hard dependency of the
unit suite.

## Decision

The model is a **dependency injected into the pure core** as a `ModelClient` interface
(`returnAssessment`, `returnSummary`), each returning the raw tool output to be validated.

- **Tests and the eval inject a STUB** that returns canned tool outputs — deterministic, no key, no network,
  CI-safe. The real model is never called in tests/eval/CI, and the shared core stays pure (functional core,
  imperative shell).
- **The edge function injects the real Anthropic client** at the boundary (`supabase/functions/run-workflow`),
  reading `ANTHROPIC_API_KEY` from the environment / Supabase Edge Function secrets.
- **The key is never committed.** `.env*` stays gitignored; `.env.example` carries a placeholder only; the real
  value is set via `supabase secrets set` for a live run. The key is needed **only** for an actual model call —
  never for the unit suite, the RLS test, typecheck, lint, or the function booting.

## Options considered

1. **(Chosen) Inject the model client; stub in tests, real client at the boundary.** Pure core, deterministic
   CI, secret confined to live runs.
2. **(Rejected) Call the SDK inside the core and read the key there.** Impure core (can't be Deno/Node-shared
   cleanly), and tests/CI need a real key and hit the network non-deterministically.
3. **(Rejected) Mock the network layer in tests instead of injecting.** Tests the mock, not the contract;
   still couples the core to the SDK's shape.

## Consequences

- The full unit + RLS suite, typecheck, lint, and the edge function's boot/import-map all verify with **no key
  and no network**; only a real model call needs the secret.
- The same pure pipeline runs in production (real client) and in tests/eval (stub) — one implementation,
  exercised by the code that ships.
- The two model calls remain structurally validated (forced `tool_choice`, zod `safeParse`) regardless of which
  client is injected ([ADR-0001](0001-structured-output-over-freetext.md)).
