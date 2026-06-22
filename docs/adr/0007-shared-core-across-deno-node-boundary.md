# ADR 0007 — Shared pure-logic core across the Deno (edge) / Node (test) runtime boundary

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

The agentic orchestrator runs as a **Supabase Edge Function**, which executes on the **Deno** runtime. The
unit tests and the eval harness run on **Node** (locally and in GitHub Actions CI). Same language
(TypeScript), two runtimes that differ in ways that bite immediately:

- **Module resolution / imports.** Deno uses explicit ESM specifiers — full paths with `.ts`, and external
  packages via `npm:`/`jsr:` or an import map; Node/Vitest resolves bare specifiers (`zod`) out of
  `node_modules`.
- **Globals and environment.** Secrets are `Deno.env.get(...)` in the edge function vs `process.env` in Node;
  `Deno.*` doesn't exist in Node, and Node built-ins (`fs`, `Buffer`, `node:crypto`) aren't available in Deno
  without the `node:` prefix.
- **SDK import shape.** `import Anthropic from "npm:@anthropic-ai/sdk"` (Deno) vs `"@anthropic-ai/sdk"` (Node).

The naive way to dodge these differences is to **duplicate** the scoring/validation logic per runtime. That
creates two sources of truth: a bug fixed in one copy isn't fixed in the other, and the test suite ends up
validating a *different* implementation than the one running in production. That directly violates the
single-source-of-truth rule.

## Decision

Keep the **pure logic** — `schema.ts` (zod), `scoring.ts` (risk tier), `reflect.ts` (validation gate) — in a
**framework-free shared core** (`src/lib/shared/`) with **zero runtime APIs**: no `Deno.*`, no `process.env`,
no `node:` imports, no I/O, no network. Pure functions in, pure data out. Both the edge function and the tests
import the **identical** modules; all runtime-specific I/O (env, Supabase, Anthropic) lives at the **boundary**
(functional core, imperative shell). Make the shared import resolve in both runtimes via a `deno.json` import
map that mirrors Node's resolution, and **pin the same `zod` version** in both. **Inject** the model call and
DB access into the core as parameters, so the eval can run the pipeline against a stub and the core never
touches a runtime API.

## Options considered

1. **(Chosen) Edge Function (Deno) + shared framework-free core.**
   *Pros:* satisfies the explicit goal of demonstrating Supabase **edge-function + scheduled-trigger**
   experience; the scheduled "daily monitor" is genuinely better hosted as a data-adjacent background job
   **decoupled from the web app**; single source of truth preserved via the shared core.
   *Cons:* a real cross-runtime seam to manage (import map, version pinning, dependency injection).
2. **(Rejected) Run the orchestrator in a Next.js API route (all Node).**
   *Pros:* **the simpler engineering choice for a demo this size** — one runtime, no seam, none of the
   import-map/version-pinning ceremony.
   *Cons:* does **not** demonstrate the edge-function experience the described role explicitly lists; couples the scheduled
   background workflow to the web app's deployment and gives up Supabase-native scheduling / DB-webhook
   triggers. **Rejected because** (a) demonstrating edge functions is a stated purpose of this artifact, and
   (b) for a scheduled monitor decoupled from the UI, the edge function is also the more production-appropriate
   home — so the requirement and the architecture agree. (Were the edge requirement absent, this simpler option
   would be the default.)
3. **(Rejected) Duplicate the logic per runtime.** Two sources of truth; the tests would validate a different
   implementation than production. Rejected outright.

## Consequences

- One implementation of the pure logic, exercised by the exact code that runs in production.
- A small, documented runtime seam: `deno.json` import map + pinned `zod` + dependency injection at the
  boundary. (Same instinct as locking a shared test corpus across two languages.)
- **Revisit trigger:** if the edge-function requirement ever falls away, the all-Node Next.js API route
  (Option 2) becomes the simpler default — supersede this ADR then.
