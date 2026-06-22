/**
 * Risk-scoring and escalation thresholds.
 *
 * ⚠️ ILLUSTRATIVE, NON-CLINICAL DEMO DEFAULTS — NOT clinically validated.
 * These numbers exist only to make the demo workflow runnable. They must be
 * configured with qualified clinical input before any real use. See ADR-0008.
 *
 * This is the SINGLE source of tuning: no risk/escalation thresholds are
 * hardcoded anywhere else in the codebase. `scoring.ts` and `reflect.ts`
 * read every cutoff from here.
 */
export const THRESHOLDS = {
  /** Official risk tier, derived from total score as a fraction of the maximum possible. */
  riskTier: {
    /** total / max ≥ this ⇒ at least `action_required` (40% of max). */
    actionRequiredAtOrAbove: 0.4,
    /** total / max ≥ this ⇒ `urgent` (70% of max). Below `actionRequiredAtOrAbove` ⇒ `stable`. */
    urgentAtOrAbove: 0.7,
  },

  /**
   * An item is "critical" (must be surfaced in the summary) when its score reaches
   * this fraction of its own maximum. 1.0 ⇒ only items scored at their max are critical.
   */
  criticalItemAtFractionOfMax: 1.0,

  /**
   * The designated safety item forces escalation + manual review when its score
   * exceeds this cutoff. 0 ⇒ any non-zero score on the safety item escalates.
   */
  safetyItemEscalatesAboveScore: 0,
} as const;
