# ADR 0010 — Safety-critical designations come from explicit schema, never inferred from text

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

The reflection gate escalates on the designated **safety item** (any non-zero score forces escalation +
`needs_manual_review`, ADR-0004/ADR-0008). The first Phase-3 cut identified that item by a marker substring in
the item's **prompt text** (`"(safety item)"`). That is the same class of mistake ADR-0001 rejects for model
output — deriving a load-bearing decision from free text. For a **safety-critical** designation it is worse:
an edited prompt, a translation, or a typo silently turns the safety item into an ordinary one, and the
escalation disappears with no error.

## Decision

A screener item's safety designation is an **explicit schema fact**: `screener_items.is_safety_item boolean not
null default false`. `scoring.ts` / `reflect.ts` already key escalation off `ScoredItem.is_safety_item`; the
edge function now maps that flag **straight from the column** and the prompt-text inference path is removed
entirely. This extends ADR-0001's "structure, not prose" principle from model output to the **data model**:
anything safety-critical is a typed, explicit field — never parsed out of human-readable text.

## Options considered

1. **(Chosen) Explicit `is_safety_item` column; the only source of the designation.** Robust, typed, seedable,
   testable.
2. **(Rejected) Infer from a prompt-text marker.** Fragile — prompt edits/translation/typos silently drop the
   safety escalation; not auditable.
3. **(Rejected) Hardcode the safety item id in app config.** Couples the app to specific seed ids; breaks for
   any real screener; still not in the database where RLS and tests can see it.

## Consequences

- The safety designation survives prompt edits and is set in the seed via the column; a test asserts exactly the
  designated item carries the flag.
- Adding a safety item to a new screener is a data operation (`is_safety_item = true`), not a code change.
- Reinforces the project rule: safety-critical inputs are explicit schema, validated structure — never inferred
  from text ([ADR-0001](0001-structured-output-over-freetext.md)).
