import { describe, it, expect } from "vitest";
import { Assessment, SummaryDraft } from "../src/lib/shared/schema.ts";

describe("Assessment schema", () => {
  it("accepts a well-formed assessment", () => {
    const result = Assessment.safeParse({
      signals: [{ kind: "symptom_increase", note: "anxiety items rising", item_ids: ["i1"] }],
      suggested_risk: "action_required",
      confidence: "medium",
      needs_manual_review: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown risk enum value", () => {
    const result = Assessment.safeParse({
      signals: [],
      suggested_risk: "catastrophic",
      confidence: "high",
      needs_manual_review: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing needs_manual_review flag", () => {
    const result = Assessment.safeParse({
      signals: [],
      suggested_risk: "stable",
      confidence: "high",
    });
    expect(result.success).toBe(false);
  });
});

describe("SummaryDraft schema", () => {
  it("accepts a non-empty summary with cited ids", () => {
    const result = SummaryDraft.safeParse({
      summary_md: "- Mood declined this week.",
      cited_item_ids: ["i1", "i2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty summary_md", () => {
    const result = SummaryDraft.safeParse({ summary_md: "", cited_item_ids: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a summary_md over the length bound", () => {
    const result = SummaryDraft.safeParse({
      summary_md: "x".repeat(801),
      cited_item_ids: [],
    });
    expect(result.success).toBe(false);
  });
});
