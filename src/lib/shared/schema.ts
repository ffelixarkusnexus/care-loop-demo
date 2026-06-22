/**
 * Shared, framework-free schema + domain types.
 *
 * Pure declarations only — zero runtime APIs (no Deno.*, no process.env, no I/O),
 * so this module is imported byte-for-byte by both the Deno edge function and the
 * Node/Vitest tests (ADR-0007). Model output is zod-validated before any use (ADR-0001).
 */
import { z } from "zod";

/** Official risk tiers. The authoritative tier is computed in code (ADR-0002), never by the model. */
export const RiskTier = z.enum(["stable", "action_required", "urgent"]);
export type RiskTier = z.infer<typeof RiskTier>;

/** One signal the model claims to detect over time. */
export const Signal = z.object({
  kind: z.enum(["sentiment_trend", "symptom_increase", "stable", "other"]),
  note: z.string().max(200),
  item_ids: z.array(z.string()).max(20),
});
export type Signal = z.infer<typeof Signal>;

/**
 * Structured assessment returned by the reasoning call (model output → validated).
 * `suggested_risk` / `confidence` / `needs_manual_review` are advisory hints only;
 * they have no authority over the official tier or the safety gate (ADR-0002, ADR-0004).
 */
export const Assessment = z.object({
  signals: z.array(Signal).max(10),
  suggested_risk: RiskTier,
  confidence: z.enum(["low", "medium", "high"]),
  needs_manual_review: z.boolean(),
});
export type Assessment = z.infer<typeof Assessment>;

/** Clinician-facing summary draft returned by the drafting call (model output → validated). */
export const SummaryDraft = z.object({
  summary_md: z.string().min(1).max(800),
  cited_item_ids: z.array(z.string()).max(20),
});
export type SummaryDraft = z.infer<typeof SummaryDraft>;

/**
 * Trusted source data read from the database (NOT model output) — plain types.
 * One screener item the patient was scored on.
 */
export interface ScoredItem {
  item_id: string;
  prompt: string;
  /** The patient's score on this item (e.g. 0–3). */
  score: number;
  /** The maximum possible score for this item. */
  max_score: number;
  /** Whether this is the designated safety item. */
  is_safety_item: boolean;
}

/** The patient's real source data for one workflow run. */
export interface SourceData {
  items: ScoredItem[];
}
