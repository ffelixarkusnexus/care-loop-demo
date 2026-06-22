/**
 * The deterministic patient-safety gate (ADR-0004).
 *
 * The authoritative review/escalation decision is computed HERE, in code, over
 * (a) the patient's real source data and (b) the STRUCTURE of the model output —
 * never over the model's self-assessment. The model's confidence / needs_manual_review
 * is escalate-only (monotonic): it can add caution, never clear a block. Default is block.
 *
 * Pure function, zero runtime APIs — shared by the edge function and the tests (ADR-0007).
 *
 * Honest limit: these checks gate SAFETY INVARIANTS, not clinical quality. The banned
 * lexicon and number checks are necessarily incomplete; a human clinician remains the
 * authority for correctness and signs off before `final`.
 */
import { SummaryDraft } from "./schema.ts";
import type { Assessment, RiskTier, SourceData } from "./schema.ts";
import type { ScoreResult } from "./scoring.ts";

export interface ReflectResult {
  /** "block" → needs_manual_review; "allow" → staged_for_review (never `final`). */
  decision: "block" | "allow";
  /** Create the alert / force top-of-triage. Independent of block. */
  escalate: boolean;
  /** Human-readable, auditable reasons for the decision. */
  reasons: string[];
}

/** Deterministic banned-content lexicon: diagnosis labels, medication directives, second-person advice. */
const BANNED: { re: RegExp; label: string }[] = [
  { re: /\byou (should|must|need to|ought to)\b/i, label: "second-person advice" },
  { re: /\b(increase|decrease|adjust|start|stop|titrate)\s+(your\s+)?(dose|dosage|medication|meds)\b/i, label: "medication directive" },
  { re: /\b\d+\s?mg\b/i, label: "medication directive (dosage)" },
  { re: /\bprescrib\w*\b/i, label: "medication directive" },
  { re: /\bdiagnos(e|is|ed|ing)\b/i, label: "diagnostic label" },
  { re: /\b(major depressive|bipolar|schizophreni\w*|borderline)\s+disorder\b/i, label: "diagnostic label" },
];

const TIER_PHRASES: Record<RiskTier, RegExp> = {
  stable: /\bstable\b/i,
  action_required: /\baction[ _-]required\b/i,
  urgent: /\burgent\b/i,
};

const ALL_TIERS: RiskTier[] = ["stable", "action_required", "urgent"];

export function reflect(
  draftInput: unknown,
  assessment: Assessment,
  source: SourceData,
  score: ScoreResult,
): ReflectResult {
  const reasons: string[] = [];
  let block = false;
  let escalate = false;

  // 1. Structural — the draft must satisfy its schema before any content check.
  const parsed = SummaryDraft.safeParse(draftInput);
  if (!parsed.success) {
    block = true;
    reasons.push("structural: summary draft failed schema validation");
  }
  const draft = parsed.success ? parsed.data : null;

  if (draft) {
    const realIds = new Set(source.items.map((i) => i.item_id));

    // 2. Grounding — every cited id must be a real item id.
    const fabricated = draft.cited_item_ids.filter((id) => !realIds.has(id));
    if (fabricated.length > 0) {
      block = true;
      reasons.push(`grounding: cited item id(s) not in source data: ${fabricated.join(", ")}`);
    }

    // 2b. Grounding (numbers) — any "N/M" figure must equal a real item score or the code-computed total.
    for (const m of draft.summary_md.matchAll(/(\d+)\s*\/\s*(\d+)/g)) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const matchesItem = source.items.some((i) => i.score === a && i.max_score === b);
      const matchesTotal = a === score.total && b === score.max;
      if (!matchesItem && !matchesTotal) {
        block = true;
        reasons.push(`numeric: summary cites ${a}/${b}, which is not a real item score or the computed total`);
      }
    }

    // 3. Must-flag coverage — every critical item must be surfaced (cited). The model cannot silently drop one.
    const cited = new Set(draft.cited_item_ids);
    const missing = score.criticalItemIds.filter((id) => !cited.has(id));
    if (missing.length > 0) {
      block = true;
      escalate = true;
      reasons.push(`must-flag: critical item(s) not surfaced in the summary: ${missing.join(", ")}`);
    }

    // 4. Numeric / risk consistency — no risk word other than the code-computed tier may appear.
    for (const tier of ALL_TIERS) {
      if (tier !== score.tier && TIER_PHRASES[tier].test(draft.summary_md)) {
        block = true;
        reasons.push(`risk: summary states '${tier}' but the computed tier is '${score.tier}'`);
      }
    }

    // 5. Banned content.
    for (const { re, label } of BANNED) {
      if (re.test(draft.summary_md)) {
        block = true;
        reasons.push(`banned: ${label}`);
      }
    }
  }

  // Data-driven escalation — thresholds on real data, independent of the model.
  if (score.tier === "urgent") {
    escalate = true;
  }
  if (score.safetyItemTriggered) {
    // The designated safety item over its cutoff forces review + escalation, regardless of the total.
    escalate = true;
    block = true;
    reasons.push("safety item over cutoff: forcing manual review and escalation");
  }

  // Model hint, demoted — escalate-only (monotonic). Caution adds a block; confidence is ignored.
  if (assessment.needs_manual_review || assessment.confidence === "low") {
    block = true;
    escalate = true;
    reasons.push("model hint: flagged manual review / low confidence (escalate-only, cannot clear a block)");
  }

  return { decision: block ? "block" : "allow", escalate, reasons };
}
