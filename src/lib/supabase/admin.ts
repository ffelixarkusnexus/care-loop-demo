import { createClient } from "@supabase/supabase-js";

/**
 * Server-only service-role client. Bypasses RLS — used ONLY to write the
 * system-owned audit_log on clinician sign-off (ADR-0011), never exposed to the
 * browser. Every call must scope org_id explicitly.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase admin env missing (SUPABASE_SERVICE_ROLE_KEY)");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
