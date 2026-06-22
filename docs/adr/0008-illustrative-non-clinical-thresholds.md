# ADR 0008 — Scoring and safety thresholds are illustrative, non-clinical demo defaults

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

`scoring.ts` (the official risk tier, ADR-0002) and `reflect.ts` (the safety gate, ADR-0004) need concrete
numbers: where `stable` / `action_required` / `urgent` fall, what makes an item "critical," and when the
designated safety item escalates. These numbers steer triage and escalation — but **this is a demo, not
clinical software** (ADR-0005), and no one on this project is qualified to set clinically valid cutoffs.

Two failure modes to avoid: (a) scattering magic numbers through the scoring/reflect code where they can't be
reviewed or tuned, and (b) presenting demo numbers as if they were validated — which would be dishonest about a
safety-critical value and is exactly the overclaiming this project refuses to do.

## Decision

All risk/escalation thresholds live in a single file, [`config/thresholds.ts`](../../config/thresholds.ts),
explicitly labeled **illustrative, non-clinical demo defaults — not clinically validated**. `scoring.ts` and
`reflect.ts` read every cutoff from there; **no threshold is hardcoded anywhere else.**

The demo defaults:

- **Risk tier** from total score as a fraction of the maximum possible: `stable` < 40%, `action_required`
  40–70%, `urgent` ≥ 70%.
- **Critical item (must-flag):** any item scored at its maximum must be surfaced in the summary; omission
  blocks (`needs_manual_review`) and escalates.
- **Safety item:** any score above 0 on the designated safety item forces escalation + `needs_manual_review`,
  regardless of the total.

These must be configured with qualified clinical input before any real use.

## Options considered

1. **(Chosen) Centralized thresholds in `config/thresholds.ts`, flagged non-clinical, plus this ADR.**
   *Pros:* one auditable, tunable source of truth; honest about provenance; testable. *Cons:* none material.
2. **(Rejected) Hardcode the numbers inline in `scoring.ts` / `reflect.ts`.** Scattered, unreviewable,
   untunable; invites the same magic number to drift between files.
3. **(Rejected) Present the numbers as clinically reasonable.** Dishonest about a safety-critical value;
   contradicts the project's no-overclaiming stance and ADR-0004's honest-limit principle.

## Consequences

- The thresholds are a single, clearly-labeled, unit-tested config surface; tuning them is a one-file change
  with no code edits.
- The demo never implies clinical validity; the provenance of every cutoff is explicit.
- **Revisit:** replace the defaults with clinically-reviewed values (and document the source) before any
  non-demo use; the structure is built to make that a config change, not a rewrite.
