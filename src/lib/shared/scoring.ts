/**
 * Deterministic risk scoring — the OFFICIAL risk tier is computed here in code,
 * never by the model (ADR-0002). Pure function, zero runtime APIs, shared by the
 * edge function and the tests (ADR-0007). All cutoffs come from config/thresholds.ts.
 */
import { THRESHOLDS } from "../../../config/thresholds.ts";
import type { RiskTier, SourceData } from "./schema.ts";

export interface ScoreResult {
  /** Sum of the patient's item scores. */
  total: number;
  /** Sum of the maximum possible item scores. */
  max: number;
  /** total / max, or 0 when there is nothing to score. */
  fraction: number;
  /** The official risk tier. */
  tier: RiskTier;
  /** Item ids scored at their maximum — must be surfaced in the summary (ADR-0004). */
  criticalItemIds: string[];
  /** Whether the designated safety item is over its escalation cutoff. */
  safetyItemTriggered: boolean;
}

export function computeScore(source: SourceData): ScoreResult {
  const total = source.items.reduce((sum, i) => sum + i.score, 0);
  const max = source.items.reduce((sum, i) => sum + i.max_score, 0);
  const fraction = max > 0 ? total / max : 0;

  const tier: RiskTier =
    fraction >= THRESHOLDS.riskTier.urgentAtOrAbove
      ? "urgent"
      : fraction >= THRESHOLDS.riskTier.actionRequiredAtOrAbove
        ? "action_required"
        : "stable";

  const criticalItemIds = source.items
    .filter(
      (i) =>
        i.max_score > 0 &&
        i.score >= i.max_score * THRESHOLDS.criticalItemAtFractionOfMax,
    )
    .map((i) => i.item_id);

  const safetyItemTriggered = source.items.some(
    (i) => i.is_safety_item && i.score > THRESHOLDS.safetyItemEscalatesAboveScore,
  );

  return { total, max, fraction, tier, criticalItemIds, safetyItemTriggered };
}
