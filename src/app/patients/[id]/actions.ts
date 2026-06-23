"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Clinician sign-off is recorded in the system-owned audit_log via the service
// role (ADR-0011); a user cannot write audit rows directly.
async function auditSignoff(orgId: string, actorId: string, action: string, summaryId: string) {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("audit_log").insert({
      org_id: orgId,
      actor: actorId,
      action,
      entity: "summary",
      entity_id: summaryId,
    });
  } catch {
    // Service-role key not configured locally — the status change still applies; audit is best-effort.
  }
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  return { supabase, user };
}

/** Approve → status = final. Nothing reaches final without this sign-off. */
export async function approveSummary(formData: FormData) {
  const summaryId = String(formData.get("summaryId"));
  const orgId = String(formData.get("orgId"));
  const patientId = String(formData.get("patientId"));
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("summaries").update({ status: "final" }).eq("id", summaryId);
  if (error) throw error;
  await auditSignoff(orgId, user.id, "signoff:final", summaryId);
  revalidatePath(`/patients/${patientId}`);
}

/** Reject → back to needs_manual_review. */
export async function rejectSummary(formData: FormData) {
  const summaryId = String(formData.get("summaryId"));
  const orgId = String(formData.get("orgId"));
  const patientId = String(formData.get("patientId"));
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("summaries")
    .update({ status: "needs_manual_review" })
    .eq("id", summaryId);
  if (error) throw error;
  await auditSignoff(orgId, user.id, "signoff:rejected", summaryId);
  revalidatePath(`/patients/${patientId}`);
}

/** Edit the draft, then leave it staged for review (still requires sign-off to reach final). */
export async function editSummary(formData: FormData) {
  const summaryId = String(formData.get("summaryId"));
  const orgId = String(formData.get("orgId"));
  const patientId = String(formData.get("patientId"));
  const summaryMd = String(formData.get("summaryMd"));
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("summaries")
    .update({ summary_md: summaryMd, status: "staged_for_review" })
    .eq("id", summaryId);
  if (error) throw error;
  await auditSignoff(orgId, user.id, "signoff:edited", summaryId);
  revalidatePath(`/patients/${patientId}`);
}
