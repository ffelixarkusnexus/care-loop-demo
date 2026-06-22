# ADR 0004 — The patient-safety gate is deterministic; the model has no authority over what reaches a clinician

- **Status:** Accepted
- **Date:** 2026-06-22
- **Decider:** Francisco

## Context

The product surfaces AI-drafted clinical summaries to clinicians. The tempting safety control is to ask the
model to flag when it is "unsure" (a `confidence` score / `needs_manual_review` field). That is **the model
grading its own homework** — a non-deterministic self-assessment presented as a control. If the model's
self-report decides whether a summary is safe to surface, safety is a **wish, not a gate**, and a
*confidently-wrong* output — the dominant, most dangerous failure mode in behavioral health — sails straight
through. The output is also unauditable: "the model said it was confident" is not a reason a clinician or a
regulator can inspect.

## Decision

The authoritative review/escalation decision is computed by **deterministic code** (`reflect.ts`) over (a) the
patient's **real source data** and (b) the **structure of the model output** — never over the model's
confidence.

- **Hard checks (block on any failure):** structural/schema validity; **grounding** (no fabricated item
  references; any number in the prose must equal a code-computed value); **must-flag coverage** (code derives
  the critical-item set from the real scores; the summary cannot omit one); **numeric/risk consistency** with
  the code-computed tier; **banned content** (diagnosis labels, medication directives, second-person advice).
- **Escalation** is a **threshold on real data** (computed tier = urgent, or a safety item over its cutoff),
  independent of the model.
- The model's `confidence` / `needs_manual_review` is **escalate-only (monotonic):** it can add caution, never
  clear a block. If it claims confidence, it is ignored.
- **Default is block.** Only output passing all checks reaches `staged_for_review`; a **human clinician signs
  off before `final`.** The model can never reach `final` or reduce scrutiny.

## Scope and honest limit (stated on purpose)

These deterministic checks gate **safety invariants, not clinical quality.** The banned lexicon and the
number-regex are necessarily incomplete, and **no script can deterministically decide whether a grounded
summary is clinically *good*.** Therefore the **human remains the authority for correctness.** We made the
*gating* deterministic and the *escalation* data-driven; we did **not** claim clinical correctness is
deterministic. Pretending otherwise would be a worse error than the self-grading model it replaces.

## Options considered

1. **(Chosen) Deterministic gate over real data + escalate-only model hint + mandatory human sign-off.**
   *Pros:* the safety control cannot be talked out of by a confident model; fully testable; matches "human
   strictly in the loop." *Cons:* deterministic checks cover invariants, not prose quality — mitigated by the
   human sign-off, which is the right place for that judgment anyway.
2. **(Rejected) Trust the model's `confidence`/`needs_manual_review` as the gate.** Non-deterministic; a
   confidently-wrong output is the dominant failure mode; unauditable. A wish, not a gate.
3. **(Rejected as the authoritative gate) A second LLM grading the first ("LLM-as-judge").** Still
   non-deterministic, with correlated failure modes; acceptable only as an *additional escalate-only advisory*,
   never as the control that decides what a clinician sees.

## Consequences

- The safety gate is code, unit-tested — including a hallucinated-id case, a dropped-critical-item case, a
  number-mismatch case, and a "model says confident but the rules block it" case.
- The model is **structurally incapable** of reducing review or reaching `final`.
- Clinical correctness stays a human responsibility by design; the gate's job is to refuse unsafe output and
  force escalation, not to certify quality.
- **Revisit:** thresholds and critical-item rules are config — tune them with clinical input; an LLM-as-judge
  may later be added strictly as an escalate-only advisory.
