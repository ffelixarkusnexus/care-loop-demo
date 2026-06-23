/**
 * The four-phase workflow pipeline — perceive → reason → act → reflect.
 *
 * Functional core, imperative shell (ADR-0007): this module is pure and
 * framework-free. The model call is INJECTED as `ModelClient`, so tests and the
 * eval run it against a deterministic stub (no key, no network), and the edge
 * function injects the real Anthropic client at the boundary. DB I/O also lives
 * at the boundary — this returns a WorkflowResult describing what to persist.
 *
 * The model proposes structure; deterministic code disposes:
 * - every model output is zod-validated; invalid → needs_manual_review (ADR-0001)
 * - the official risk tier is computed in code (ADR-0002)
 * - the reflection gate is deterministic and has authority over the model (ADR-0004)
 */
import { Assessment, SummaryDraft, type SourceData } from "./schema.ts";
import { computeScore, type ScoreResult } from "./scoring.ts";
import { reflect, type ReflectResult } from "./reflect.ts";

/** What perception collected: the check-in plus the patient's scored screener items. */
export interface PerceivedData {
  checkin: { mood: number | null; note: string | null };
  source: SourceData;
}

/** Context handed to the drafting call. */
export interface SummaryContext {
  data: PerceivedData;
  assessment: Assessment;
  score: ScoreResult;
}

/**
 * The injected model. Each method returns the RAW tool output (`unknown`); the
 * pipeline validates it. The real implementation forces tool_choice; the stub
 * returns canned objects.
 */
export interface ModelClient {
  returnAssessment(data: PerceivedData): Promise<unknown>;
  returnSummary(ctx: SummaryContext): Promise<unknown>;
}

export type WorkflowStatus = "needs_manual_review" | "staged_for_review";
export type Phase = "perception" | "reasoning" | "action" | "reflection";

export interface AuditEvent {
  phase: Phase;
  action: string;
}

export interface WorkflowResult {
  status: WorkflowStatus;
  score: ScoreResult;
  assessment: Assessment | null;
  draft: SummaryDraft | null;
  reflection: ReflectResult | null;
  /** Create the alert row + dashboard badge (urgent tier or safety item, or gate escalation). */
  alert: boolean;
  audit: AuditEvent[];
  reasons: string[];
}

export async function runWorkflow(data: PerceivedData, model: ModelClient): Promise<WorkflowResult> {
  const audit: AuditEvent[] = [{ phase: "perception", action: "collected_checkin_and_scores" }];

  // The official risk tier is computed in code regardless of what the model says.
  const score = computeScore(data.source);
  const dataDrivenAlert = score.tier === "urgent" || score.safetyItemTriggered;

  // --- Reasoning: one model call, validated ---
  const rawAssessment = await model.returnAssessment(data);
  const parsedAssessment = Assessment.safeParse(rawAssessment);
  if (!parsedAssessment.success) {
    audit.push({ phase: "reasoning", action: "assessment_invalid" });
    return abort(score, null, null, null, dataDrivenAlert, audit, [
      "assessment failed schema validation",
    ]);
  }
  const assessment = parsedAssessment.data;
  audit.push({ phase: "reasoning", action: "assessment_validated" });

  // --- Autonomous action: draft a summary; alert on urgent/safety ---
  const rawSummary = await model.returnSummary({ data, assessment, score });
  const parsedSummary = SummaryDraft.safeParse(rawSummary);
  if (dataDrivenAlert) audit.push({ phase: "action", action: "alert_created" });
  if (!parsedSummary.success) {
    audit.push({ phase: "action", action: "summary_invalid" });
    return abort(score, assessment, null, null, dataDrivenAlert, audit, [
      "summary failed schema validation",
    ]);
  }
  const draft = parsedSummary.data;
  audit.push({ phase: "action", action: "summary_drafted" });

  // --- Reflection: deterministic gate over the real data ---
  const reflection = reflect(draft, assessment, data.source, score);
  const status: WorkflowStatus =
    reflection.decision === "allow" ? "staged_for_review" : "needs_manual_review";
  audit.push({
    phase: "reflection",
    action: reflection.decision === "allow" ? "passed_staged_for_review" : "blocked_needs_manual_review",
  });
  // An alert raised by the gate's escalation (not by tier/safety) is also audited.
  if (reflection.escalate && !dataDrivenAlert) {
    audit.push({ phase: "reflection", action: "alert_created" });
  }

  return {
    status,
    score,
    assessment,
    draft,
    reflection,
    alert: dataDrivenAlert || reflection.escalate,
    audit,
    reasons: reflection.reasons,
  };
}

function abort(
  score: ScoreResult,
  assessment: Assessment | null,
  draft: SummaryDraft | null,
  reflection: ReflectResult | null,
  alert: boolean,
  audit: AuditEvent[],
  reasons: string[],
): WorkflowResult {
  return { status: "needs_manual_review", score, assessment, draft, reflection, alert, audit, reasons };
}
