import { describe, it, expect } from "vitest";
import { computeScore } from "../src/lib/shared/scoring.ts";
import type { ScoredItem } from "../src/lib/shared/schema.ts";

function item(
  id: string,
  score: number,
  max_score = 3,
  is_safety_item = false,
): ScoredItem {
  return { item_id: id, prompt: `prompt-${id}`, score, max_score, is_safety_item };
}

describe("computeScore — totals", () => {
  it("sums total, max, and fraction", () => {
    const r = computeScore({ items: [item("a", 1), item("b", 2), item("c", 0)] });
    expect(r.total).toBe(3);
    expect(r.max).toBe(9);
    expect(r.fraction).toBeCloseTo(1 / 3);
  });

  it("is stable with a zero/empty screener (no divide-by-zero)", () => {
    const r = computeScore({ items: [] });
    expect(r.total).toBe(0);
    expect(r.max).toBe(0);
    expect(r.fraction).toBe(0);
    expect(r.tier).toBe("stable");
    expect(r.criticalItemIds).toEqual([]);
    expect(r.safetyItemTriggered).toBe(false);
  });
});

describe("computeScore — risk tier from fraction of max", () => {
  // five items, max_score 2 each => max total 10, so fractions are exact tenths.
  const five = (scores: number[]) => ({
    items: scores.map((s, i) => item(`i${i}`, s, 2)),
  });

  it("stable below 40%", () => {
    expect(computeScore(five([1, 1, 1, 0, 0])).tier).toBe("stable"); // 3/10 = 0.30
  });

  it("action_required at exactly 40%", () => {
    expect(computeScore(five([2, 2, 0, 0, 0])).tier).toBe("action_required"); // 4/10 = 0.40
  });

  it("action_required between 40% and 70%", () => {
    expect(computeScore(five([2, 2, 1, 0, 0])).tier).toBe("action_required"); // 5/10 = 0.50
  });

  it("urgent at exactly 70%", () => {
    expect(computeScore(five([2, 2, 2, 1, 0])).tier).toBe("urgent"); // 7/10 = 0.70
  });

  it("urgent above 70%", () => {
    expect(computeScore(five([2, 2, 2, 2, 0])).tier).toBe("urgent"); // 8/10 = 0.80
  });
});

describe("computeScore — critical items", () => {
  it("lists item ids scored at their maximum", () => {
    const r = computeScore({ items: [item("a", 3), item("b", 1), item("c", 3)] });
    expect(r.criticalItemIds).toEqual(["a", "c"]);
  });

  it("is empty when no item reaches its max", () => {
    const r = computeScore({ items: [item("a", 2), item("b", 1)] });
    expect(r.criticalItemIds).toEqual([]);
  });
});

describe("computeScore — safety item", () => {
  it("triggers when the designated safety item is above 0", () => {
    const r = computeScore({ items: [item("a", 0), item("safety", 1, 3, true)] });
    expect(r.safetyItemTriggered).toBe(true);
  });

  it("does not trigger when the safety item is 0", () => {
    const r = computeScore({ items: [item("a", 2), item("safety", 0, 3, true)] });
    expect(r.safetyItemTriggered).toBe(false);
  });
});
