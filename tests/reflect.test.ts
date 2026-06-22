import { describe, it, expect } from "vitest";
import { reflect } from "../src/lib/shared/reflect.ts";
import { computeScore } from "../src/lib/shared/scoring.ts";
import type { Assessment, ScoredItem, SourceData, SummaryDraft } from "../src/lib/shared/schema.ts";

function item(id: string, score: number, max_score = 3, is_safety_item = false): ScoredItem {
  return { item_id: id, prompt: `prompt-${id}`, score, max_score, is_safety_item };
}

/** 5 regular items (max 3) + 1 designated safety item (max 3). */
function screener(regular: number[], safetyScore: number): SourceData {
  const items = regular.map((s, i) => item(`i${i}`, s, 3));
  items.push(item("safety", safetyScore, 3, true));
  return { items };
}

const confident: Assessment = {
  signals: [],
  suggested_risk: "stable",
  confidence: "high",
  needs_manual_review: false,
};

function run(draft: unknown, source: SourceData, assessment: Assessment = confident) {
  return reflect(draft, assessment, source, computeScore(source));
}

describe("reflect — allow path", () => {
  it("allows a grounded, clean, stable draft and does not escalate", () => {
    const source = screener([1, 1, 1, 0, 0], 0); // 3/18 → stable, no critical, safety calm
    const draft: SummaryDraft = {
      summary_md: "- Mood is low but steady this week; no acute concerns surfaced.",
      cited_item_ids: ["i0"],
    };
    const r = run(draft, source);
    expect(r.decision).toBe("allow");
    expect(r.escalate).toBe(false);
  });
});

describe("reflect — hard checks block", () => {
  it("blocks a hallucinated cited item id (grounding)", () => {
    const source = screener([1, 1, 1, 0, 0], 0);
    const draft: SummaryDraft = {
      summary_md: "- Mood is low but steady.",
      cited_item_ids: ["i0", "ghost-item"],
    };
    const r = run(draft, source);
    expect(r.decision).toBe("block");
    expect(r.reasons.some((x) => /grounding/i.test(x))).toBe(true);
  });

  it("blocks AND escalates when a critical item is dropped (must-flag coverage)", () => {
    const source = screener([3, 1, 0, 0, 0], 0); // i0 at max → critical; total 4/18 → stable tier
    expect(computeScore(source).criticalItemIds).toContain("i0");
    const draft: SummaryDraft = {
      summary_md: "- Some mild symptoms noted.",
      cited_item_ids: ["i1"], // omits the critical i0
    };
    const r = run(draft, source);
    expect(r.decision).toBe("block");
    expect(r.escalate).toBe(true);
    expect(r.reasons.some((x) => /must-flag/i.test(x))).toBe(true);
  });

  it("blocks a fabricated number that matches no real score or total (numeric)", () => {
    const source = screener([2, 2, 1, 0, 0], 0);
    const draft: SummaryDraft = {
      summary_md: "- The anxiety item was scored 8/3 this week.", // impossible score
      cited_item_ids: ["i0"],
    };
    const r = run(draft, source);
    expect(r.decision).toBe("block");
    expect(r.reasons.some((x) => /numeric/i.test(x))).toBe(true);
  });

  it("blocks a risk word that contradicts the computed tier (risk consistency)", () => {
    const source = screener([1, 1, 1, 0, 0], 0); // stable
    const draft: SummaryDraft = {
      summary_md: "- The situation looks urgent.", // computed tier is stable
      cited_item_ids: ["i0"],
    };
    const r = run(draft, source);
    expect(r.decision).toBe("block");
    expect(r.reasons.some((x) => /risk/i.test(x))).toBe(true);
  });

  it("blocks second-person advice (banned content)", () => {
    const source = screener([1, 1, 1, 0, 0], 0);
    const draft: SummaryDraft = {
      summary_md: "- You should call your doctor and increase your dose.",
      cited_item_ids: ["i0"],
    };
    const r = run(draft, source);
    expect(r.decision).toBe("block");
    expect(r.reasons.some((x) => /banned/i.test(x))).toBe(true);
  });

  it("blocks a structurally invalid draft", () => {
    const source = screener([1, 1, 1, 0, 0], 0);
    const r = run({ summary_md: "", cited_item_ids: [] }, source); // empty summary fails schema
    expect(r.decision).toBe("block");
    expect(r.reasons.some((x) => /structural/i.test(x))).toBe(true);
  });
});

describe("reflect — model self-assessment has no authority", () => {
  it("blocks despite the model claiming high confidence (confidence cannot clear a block)", () => {
    const source = screener([1, 1, 1, 0, 0], 0);
    const draft: SummaryDraft = {
      summary_md: "- Mood is low but steady.",
      cited_item_ids: ["i0", "ghost-item"], // grounding failure
    };
    const veryConfident: Assessment = { ...confident, confidence: "high", needs_manual_review: false };
    const r = run(draft, source, veryConfident);
    expect(r.decision).toBe("block"); // confident model does NOT clear the block
    expect(r.reasons.some((x) => /grounding/i.test(x))).toBe(true);
  });

  it("treats a model needs_manual_review flag as escalate-only (adds a block)", () => {
    const source = screener([1, 1, 1, 0, 0], 0); // otherwise an allow
    const draft: SummaryDraft = {
      summary_md: "- Mood is low but steady.",
      cited_item_ids: ["i0"],
    };
    const cautious: Assessment = { ...confident, needs_manual_review: true };
    const r = run(draft, source, cautious);
    expect(r.decision).toBe("block");
    expect(r.escalate).toBe(true);
  });
});

describe("reflect — data-driven escalation", () => {
  it("blocks and escalates when the safety item is over its cutoff, even on a clean draft", () => {
    const source = screener([1, 1, 1, 0, 0], 2); // safety item > 0 → forces review + escalation
    const draft: SummaryDraft = {
      summary_md: "- Mood is low but steady.",
      cited_item_ids: ["i0"],
    };
    const r = run(draft, source);
    expect(r.decision).toBe("block");
    expect(r.escalate).toBe(true);
    expect(r.reasons.some((x) => /safety item/i.test(x))).toBe(true);
  });

  it("allows but escalates an urgent-tier draft that surfaces every critical item", () => {
    const source = screener([3, 3, 3, 3, 1], 0); // total 13/18 → urgent; i0..i3 critical; safety calm
    const score = computeScore(source);
    expect(score.tier).toBe("urgent");
    const draft: SummaryDraft = {
      summary_md: "- Symptoms are urgent across several items and warrant prompt review.",
      cited_item_ids: ["i0", "i1", "i2", "i3"],
    };
    const r = run(draft, source);
    expect(r.decision).toBe("allow");
    expect(r.escalate).toBe(true);
  });
});
