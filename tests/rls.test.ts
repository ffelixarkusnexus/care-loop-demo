/**
 * Cross-tenant isolation proof (ADR-0003): a user in org A must read ZERO of org B's rows.
 *
 * Self-contained — builds its own two-org fixture via the service role, then queries as a
 * real authenticated user A. Requires a running Supabase stack; reads connection details
 * from env. If they are absent (no local stack / no hosted project), the whole suite is
 * SKIPPED with a clear message — it is never reported as passing without actually running.
 *
 * To run against the local stack:
 *   npx supabase start
 *   export $(npx supabase status -o env | grep -E 'API_URL|ANON_KEY|SERVICE_ROLE_KEY')
 *   # map to the names below, then: npm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(url && anonKey && serviceKey);

if (!ready) {
  console.warn(
    "[rls.test] SKIPPED — no Supabase connection env found " +
      "(need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY). " +
      "Written but UNVERIFIED until a local stack or hosted project is provided.",
  );
}

const stamp = Date.now();
const password = "demo-password-rls-test";

interface Tenant {
  orgId: string;
  userId: string;
  email: string;
  checkinId: string;
}

async function makeTenant(admin: SupabaseClient, label: string): Promise<Tenant> {
  const { data: org, error: orgErr } = await admin
    .from("orgs")
    .insert({ name: `RLS ${label} ${stamp}` })
    .select()
    .single();
  if (orgErr) throw orgErr;

  const email = `rls-${label}-${stamp}@careloop.test`.toLowerCase();
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw userErr;
  const userId = created.user.id;

  const { error: memErr } = await admin
    .from("memberships")
    .insert({ org_id: org.id, user_id: userId, role: "clinician" });
  if (memErr) throw memErr;

  const { data: checkin, error: ciErr } = await admin
    .from("checkins")
    .insert({ org_id: org.id, member_user_id: userId, mood: 3, note: `${label} note` })
    .select()
    .single();
  if (ciErr) throw ciErr;

  return { orgId: org.id, userId, email, checkinId: checkin.id };
}

describe.skipIf(!ready)("RLS — cross-tenant isolation", () => {
  let admin: SupabaseClient;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    a = await makeTenant(admin, "a");
    b = await makeTenant(admin, "b");
  });

  afterAll(async () => {
    if (!admin) return;
    // Guarded so a failed beforeAll can't mask the real error here.
    // FK on delete cascade removes memberships/checkins for each org and user.
    const orgIds = [a?.orgId, b?.orgId].filter(Boolean) as string[];
    if (orgIds.length) await admin.from("orgs").delete().in("id", orgIds);
    if (a?.userId) await admin.auth.admin.deleteUser(a.userId);
    if (b?.userId) await admin.auth.admin.deleteUser(b.userId);
  });

  it("lets user A read org A's checkin", async () => {
    const userA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErr } = await userA.auth.signInWithPassword({ email: a.email, password });
    expect(signInErr).toBeNull();

    const { data, error } = await userA.from("checkins").select("id, org_id");
    expect(error).toBeNull();
    expect(data?.some((row) => row.id === a.checkinId)).toBe(true);
  });

  it("returns ZERO of org B's rows to user A", async () => {
    const userA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErr } = await userA.auth.signInWithPassword({ email: a.email, password });
    expect(signInErr).toBeNull();

    const { data, error } = await userA.from("checkins").select("id, org_id");
    expect(error).toBeNull();
    // The core invariant: user A sees none of org B's rows.
    expect(data?.filter((row) => row.org_id === b.orgId)).toEqual([]);
    expect(data?.some((row) => row.id === b.checkinId)).toBe(false);
    // And everything A does see belongs to org A.
    expect(data?.every((row) => row.org_id === a.orgId)).toBe(true);
  });

  it("returns ZERO checkins to an unauthenticated (anon) client", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await anon.from("checkins").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
