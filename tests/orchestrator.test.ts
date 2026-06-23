import { describe, it, expect } from "vitest";
import { runWorkflow, type ModelClient, type PerceivedData } from "../src/lib/shared/orchestrator.ts";
import type { ScoredItem } from "../src/lib/shared/schema.ts";

function item(id: string, score: number, max_score = 3, is_safety_item = false): ScoredItem {
  return { item_id: id, prompt: `prompt-${id}`, score, max_score, is_safety_item };
}

/** 5 regular items (max 3) + 1 safety item (max 3). */
function perceived(regular: number[], safetyScore: number): PerceivedData {
  const items = regular.map((s, i) => item(`i${i}`, s, 3));
  items.push(item("safety", safetyScore, 3, true));
  return { checkin: { mood: 2, note: "rough week" }, source: { items } };
}

/** Injected stub — returns canned tool outputs, never touches the network. */
function stubModel(assessment: unknown, summary: unknown): ModelClient {
  return {
    returnAssessment: async () => assessment,
    returnSummary: async () => summary,
  };
}

const validAssessment = {
  signals: [{ kind: "symptom_increase", note: "anxiety rising", item_ids: ["i1"] }],
  suggested_risk: "stable",
  confidence: "high",
  needs_manual_review: false,
};

describe("runWorkflow — happy path", () => {
  it("stages a clean, grounded, stable draft for review and does not alert", async () => {
    const data = perceived([1, 1, 1, 0, 0], 0); // stable, no critical, safety calm
    const model = stubModel(validAssessment, {
      summary_md: "- Mood is low but steady this week.",
      cited_item_ids: ["i0"],
    });
    const r = await runWorkflow(data, model);
    expect(r.status).toBe("staged_for_review");
    expect(r.alert).toBe(false);
    expect(r.reflection?.decision).toBe("allow");
    // one audit event per phase
    expect(r.audit.map((e) => e.phase)).toEqual(
      expect.arrayContaining(["perception", "reasoning", "action", "reflection"]),
    );
  });
});

describe("runWorkflow — invalid model output aborts to manual review", () => {
  it("needs_manual_review when the assessment fails validation", async () => {
    const data = perceived([1, 1, 1, 0, 0], 0);
    const model = stubModel({ not: "an assessment" }, { summary_md: "x", cited_item_ids: [] });
    const r = await runWorkflow(data, model);
    expect(r.status).toBe("needs_manual_review");
    expect(r.assessment).toBeNull();
  });

  it("needs_manual_review when the summary fails validation", async () => {
    const data = perceived([1, 1, 1, 0, 0], 0);
    const model = stubModel(validAssessment, { summary_md: "", cited_item_ids: [] }); // empty fails schema
    const r = await runWorkflow(data, model);
    expect(r.status).toBe("needs_manual_review");
    expect(r.draft).toBeNull();
  });
});

describe("runWorkflow — deterministic gate has authority over the model", () => {
  it("blocks a hallucinated cited id even with a confident assessment", async () => {
    const data = perceived([1, 1, 1, 0, 0], 0);
    const model = stubModel(validAssessment, {
      summary_md: "- Mood is low but steady.",
      cited_item_ids: ["ghost"],
    });
    const r = await runWorkflow(data, model);
    expect(r.status).toBe("needs_manual_review");
    expect(r.reflection?.decision).toBe("block");
  });

  it("alerts and forces manual review when the safety item is over its cutoff", async () => {
    const data = perceived([1, 1, 1, 0, 0], 2); // safety item > 0
    const model = stubModel(validAssessment, {
      summary_md: "- Mood is low but steady.",
      cited_item_ids: ["i0"],
    });
    const r = await runWorkflow(data, model);
    expect(r.alert).toBe(true);
    expect(r.status).toBe("needs_manual_review");
  });

  it("audits an alert raised by the gate's escalation (model caution), not just tier/safety", async () => {
    const data = perceived([1, 1, 1, 0, 0], 0); // stable, safety calm → no data-driven alert
    const cautious = { ...validAssessment, needs_manual_review: true };
    const model = stubModel(cautious, { summary_md: "- Mood is low but steady.", cited_item_ids: ["i0"] });
    const r = await runWorkflow(data, model);
    expect(r.alert).toBe(true); // model caution → gate escalates → alert
    expect(r.status).toBe("needs_manual_review");
    expect(r.audit.some((e) => e.phase === "reflection" && e.action === "alert_created")).toBe(true);
  });
});

describe("runWorkflow — urgent tier escalates", () => {
  it("alerts and stages an urgent draft that surfaces every critical item", async () => {
    const data = perceived([3, 3, 3, 3, 1], 0); // 13/18 → urgent; i0..i3 critical
    const model = stubModel(
      { ...validAssessment, suggested_risk: "urgent" },
      {
        summary_md: "- Symptoms are urgent across several items and warrant prompt review.",
        cited_item_ids: ["i0", "i1", "i2", "i3"],
      },
    );
    const r = await runWorkflow(data, model);
    expect(r.score.tier).toBe("urgent");
    expect(r.alert).toBe(true);
    expect(r.status).toBe("staged_for_review");
  });
});
