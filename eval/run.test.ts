/**
 * Eval harness — runs the orchestrator over fixed scenarios against the INJECTED
 * STUB (no key, no network, CI-safe). It asserts INVARIANTS, not exact wording:
 * the model draft is non-deterministic, so we check the safety/structure guarantees
 * that must hold for every output, never the prose.
 */
import { describe, expect, it } from "vitest";
import casesData from "./cases.json";
import { runWorkflow, type ModelClient, type PerceivedData } from "../src/lib/shared/orchestrator.ts";
import type { ScoredItem } from "../src/lib/shared/schema.ts";

interface EvalCase {
  name: string;
  checkin: { mood: number | null; note: string | null };
  items: ScoredItem[];
  assessment: unknown;
  summary: unknown;
  expect: { tier: string; status: "staged_for_review" | "needs_manual_review" };
}

const cases = casesData as EvalCase[];

function stubModel(assessment: unknown, summary: unknown): ModelClient {
  return { returnAssessment: async () => assessment, returnSummary: async () => summary };
}

const BANNED = [/\byou (should|must|need to)\b/i, /\bdiagnos/i, /\b\d+\s?mg\b/i, /\bincrease your dose\b/i];

describe("eval — invariants over fixed scenarios", () => {
  for (const c of cases) {
    it(c.name, async () => {
      const data: PerceivedData = { checkin: c.checkin, source: { items: c.items } };
      const r = await runWorkflow(data, stubModel(c.assessment, c.summary));

      // Nothing reaches `final` from the pipeline — only a human sign-off can (ADR-0004).
      expect(["staged_for_review", "needs_manual_review"]).toContain(r.status);
      // The official risk tier is the deterministic scorer's (ADR-0002).
      expect(r.score.tier).toBe(c.expect.tier);
      // Per-scenario disposition.
      expect(r.status).toBe(c.expect.status);

      const realIds = new Set(c.items.map((i) => i.item_id));
      if (r.status === "staged_for_review") {
        // An allowed draft is schema-valid, grounded, must-flag complete, and clean.
        expect(r.draft).not.toBeNull();
        for (const id of r.draft!.cited_item_ids) expect(realIds.has(id)).toBe(true);
        for (const critical of r.score.criticalItemIds) expect(r.draft!.cited_item_ids).toContain(critical);
        for (const re of BANNED) expect(re.test(r.draft!.summary_md)).toBe(false);
      }
    });
  }

  it("sharp-decline is urgent purely from the deterministic scorer", async () => {
    const c = cases.find((x) => x.name === "sharp-decline")!;
    const r = await runWorkflow({ checkin: c.checkin, source: { items: c.items } }, stubModel(c.assessment, c.summary));
    expect(r.score.tier).toBe("urgent");
  });

  it("ambiguous is held for review or carries non-high confidence", () => {
    const c = cases.find((x) => x.name === "ambiguous")!;
    const confidence = (c.assessment as { confidence?: string }).confidence;
    expect(c.expect.status === "needs_manual_review" || confidence !== "high").toBe(true);
  });

  it("no case ever reaches final from the pipeline", async () => {
    for (const c of cases) {
      const r = await runWorkflow({ checkin: c.checkin, source: { items: c.items } }, stubModel(c.assessment, c.summary));
      expect(r.status).not.toBe("final");
    }
  });
});
