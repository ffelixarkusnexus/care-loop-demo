// Supabase Edge Function (Deno) — the four-phase orchestrator.
//
// Imperative shell only: it does I/O (auth, DB, Anthropic) and injects the model
// client into the PURE shared core (`@core/orchestrator.ts`), which it imports
// UNCHANGED — the same modules the Node tests import (ADR-0007, via deno.json).
// Two model calls, each forced via tool_choice and validated by the core (ADR-0001).
//
// Auth posture (ADR-0006):
//   - on-demand : forward the caller's JWT  → RLS applies, function only sees their org.
//   - scheduled : service role (bypasses RLS) → every query scoped by org_id explicitly.
//
// No PHI in logs: we log ids/counts/decisions only, never check-in or summary text.

import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runWorkflow, type ModelClient, type PerceivedData } from "@core/orchestrator.ts";
import type { ScoredItem } from "@core/schema.ts";

const MODEL = "claude-opus-4-8";
const PROMPT_VERSION = "2026-06-22.1";

// The designated safety item comes from the explicit `screener_items.is_safety_item`
// column (ADR-0010) — never inferred from prompt text.

// --- Model client (real Anthropic; injected into the pure core) ----------------

const ASSESSMENT_TOOL = {
  name: "return_assessment",
  description: "Return a structured assessment of the patient's check-in and screener trend.",
  input_schema: {
    type: "object",
    properties: {
      signals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["sentiment_trend", "symptom_increase", "stable", "other"] },
            note: { type: "string" },
            item_ids: { type: "array", items: { type: "string" } },
          },
          required: ["kind", "note", "item_ids"],
        },
      },
      suggested_risk: { type: "string", enum: ["stable", "action_required", "urgent"] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      needs_manual_review: { type: "boolean" },
    },
    required: ["signals", "suggested_risk", "confidence", "needs_manual_review"],
  },
} as const;

const SUMMARY_TOOL = {
  name: "return_summary",
  description: "Return a short clinician-facing summary that cites specific screener items.",
  input_schema: {
    type: "object",
    properties: {
      summary_md: { type: "string" },
      cited_item_ids: { type: "array", items: { type: "string" } },
    },
    required: ["summary_md", "cited_item_ids"],
  },
} as const;

const SYSTEM_PROMPT =
  "You summarize behavioral-health check-ins for a clinician. Be factual and concise. " +
  "Do NOT diagnose, do NOT recommend or change medication, and do NOT give the patient " +
  "second-person advice. Cite specific screener item ids. The official risk tier is computed " +
  "separately in code — describe the data, do not assert a risk level the code did not compute.";

function toolInput(message: Anthropic.Message, name: string): unknown {
  const block = message.content.find((b) => b.type === "tool_use" && b.name === name);
  return block && block.type === "tool_use" ? block.input : undefined;
}

function describe(data: PerceivedData): string {
  const items = data.source.items
    .map((i) => `- ${i.item_id} "${i.prompt}": ${i.score}/${i.max_score}${i.is_safety_item ? " [safety item]" : ""}`)
    .join("\n");
  return `Check-in mood: ${data.checkin.mood ?? "n/a"}. Note: ${data.checkin.note ?? "(none)"}.\nScreener items:\n${items}`;
}

function makeAnthropicModel(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey });
  async function call(tool: typeof ASSESSMENT_TOOL | typeof SUMMARY_TOOL, userText: string): Promise<unknown> {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: userText }],
    });
    return toolInput(message, tool.name);
  }
  return {
    returnAssessment: (data) => call(ASSESSMENT_TOOL, describe(data)),
    returnSummary: ({ data, assessment, score }) =>
      call(
        SUMMARY_TOOL,
        `${describe(data)}\n\nModel assessment: ${JSON.stringify(assessment)}.\n` +
          `Code-computed risk tier: ${score.tier} (total ${score.total}/${score.max}). ` +
          `Critical items: ${score.criticalItemIds.join(", ") || "none"}.`,
      ),
  };
}

// --- Perception: read real source data into the pure PerceivedData shape -------

async function perceive(db: SupabaseClient, checkinId: string, orgId?: string) {
  let q = db.from("checkins").select("id, org_id, member_user_id, mood, note").eq("id", checkinId);
  if (orgId) q = q.eq("org_id", orgId); // scheduled path scopes org_id explicitly (ADR-0006)
  const { data: checkin, error } = await q.single();
  if (error || !checkin) throw new Error(`checkin not found: ${error?.message ?? checkinId}`);

  const { data: rowsRaw, error: rErr } = await db
    .from("screener_results")
    .select("score, item_id, screener_items(id, prompt, max_score, is_safety_item)")
    .eq("member_user_id", checkin.member_user_id)
    .eq("org_id", checkin.org_id);
  if (rErr) throw new Error(`screener_results: ${rErr.message}`);

  type ItemEmbed = { id: string; prompt: string; max_score: number; is_safety_item: boolean };
  type ResultRow = { score: number; item_id: string; screener_items: ItemEmbed | ItemEmbed[] | null };
  const rows = (rowsRaw ?? []) as unknown as ResultRow[];

  const items: ScoredItem[] = rows.map((r) => {
    const si = Array.isArray(r.screener_items) ? r.screener_items[0] : r.screener_items;
    return {
      item_id: r.item_id,
      prompt: si?.prompt ?? "",
      score: r.score,
      max_score: si?.max_score ?? 0,
      is_safety_item: si?.is_safety_item ?? false,
    };
  });

  const data: PerceivedData = {
    checkin: { mood: checkin.mood, note: checkin.note },
    source: { items },
  };
  return { data, checkin };
}

// --- Persistence: write what the pipeline produced -----------------------------

async function persist(
  db: SupabaseClient,
  admin: SupabaseClient,
  checkin: { id: string; org_id: string; member_user_id: string },
  result: Awaited<ReturnType<typeof runWorkflow>>,
) {
  const org_id = checkin.org_id;

  const { data: assessmentRow } = await db
    .from("assessments")
    .insert({
      org_id,
      checkin_id: checkin.id,
      signals: result.assessment?.signals ?? null,
      model_risk: result.assessment?.suggested_risk ?? null,
      confidence: result.assessment?.confidence ?? null,
      needs_manual_review: result.assessment?.needs_manual_review ?? null,
      prompt_version: PROMPT_VERSION,
    })
    .select("id")
    .single();

  await db.from("summaries").insert({
    org_id,
    checkin_id: checkin.id,
    risk_tier: result.score.tier,
    summary_md: result.draft?.summary_md ?? null,
    cited_item_ids: result.draft?.cited_item_ids ?? null,
    status: result.status,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
  });

  if (result.alert) {
    await db.from("alerts").insert({
      org_id,
      member_user_id: checkin.member_user_id,
      reason: result.score.tier === "urgent" ? "urgent risk tier" : "safety item over cutoff",
    });
  }

  // audit_log: written via the service role (no insert policy on the user path).
  // Metadata only — never check-in or summary text.
  await admin.from("audit_log").insert(
    result.audit.map((e) => ({
      org_id,
      actor: "run-workflow",
      action: `${e.phase}:${e.action}`,
      entity: "checkin",
      entity_id: checkin.id,
    })),
  );

  return assessmentRow?.id;
}

// --- HTTP entrypoint -----------------------------------------------------------

Deno.serve(async (req) => {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const scheduled = body?.scheduled === true;
    const checkinId: string | undefined = body?.checkin_id;
    const orgId: string | undefined = body?.org_id;

    // Auth posture (ADR-0006).
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    let db: SupabaseClient;
    if (scheduled) {
      if (!orgId) return json({ error: "scheduled run requires org_id" }, 400);
      db = admin; // service role; every query below is scoped by org_id explicitly
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "missing Authorization (user JWT)" }, 401);
      db = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
    }
    if (!checkinId) return json({ error: "checkin_id required" }, 400);

    const model = makeAnthropicModel(apiKey);
    const { data, checkin } = await perceive(db, checkinId, scheduled ? orgId : undefined);
    const result = await runWorkflow(data, model);
    await persist(db, admin, checkin, result);

    // No PHI: ids/decisions only.
    console.log(JSON.stringify({ checkin_id: checkin.id, status: result.status, tier: result.score.tier, alert: result.alert }));
    return json({ status: result.status, risk_tier: result.score.tier, alert: result.alert, reasons: result.reasons });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
