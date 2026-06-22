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
  screenerId: string;
  itemId: string;
  auditId: string;
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

  const { data: screener, error: scErr } = await admin
    .from("screeners")
    .insert({ org_id: org.id, title: `${label} screener ${stamp}` })
    .select()
    .single();
  if (scErr) throw scErr;

  const { data: item, error: itErr } = await admin
    .from("screener_items")
    .insert({ screener_id: screener.id, prompt: `${label} item`, max_score: 3 })
    .select()
    .single();
  if (itErr) throw itErr;

  // audit_log is system-written: only the service role can insert (ADR-0011).
  const { data: audit, error: auErr } = await admin
    .from("audit_log")
    .insert({ org_id: org.id, actor: "test", action: "seed", entity: "checkin", entity_id: checkin.id })
    .select()
    .single();
  if (auErr) throw auErr;

  return {
    orgId: org.id,
    userId,
    email,
    checkinId: checkin.id,
    screenerId: screener.id,
    itemId: item.id,
    auditId: audit.id,
  };
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const c = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return c;
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

  it("returns ZERO of org B's screeners and screener_items to user A", async () => {
    const userA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErr } = await userA.auth.signInWithPassword({ email: a.email, password });
    expect(signInErr).toBeNull();

    const { data: screeners, error: scErr } = await userA.from("screeners").select("id, org_id");
    expect(scErr).toBeNull();
    expect(screeners?.some((row) => row.id === a.screenerId)).toBe(true);
    expect(screeners?.some((row) => row.id === b.screenerId)).toBe(false);
    expect(screeners?.every((row) => row.org_id === a.orgId)).toBe(true);

    // screener_items has no org_id; isolation flows through the parent screener.
    const { data: items, error: itErr } = await userA.from("screener_items").select("id, screener_id");
    expect(itErr).toBeNull();
    expect(items?.some((row) => row.id === a.itemId)).toBe(true);
    expect(items?.some((row) => row.id === b.itemId)).toBe(false);
    expect(items?.every((row) => row.screener_id === a.screenerId)).toBe(true);
  });

  it("returns ZERO checkins to an unauthenticated (anon) client", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await anon.from("checkins").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("lets user A read their org's audit_log and zero of org B's", async () => {
    const userA = await signedInClient(a.email);
    const { data, error } = await userA.from("audit_log").select("id, org_id");
    expect(error).toBeNull();
    expect(data?.some((row) => row.id === a.auditId)).toBe(true);
    expect(data?.some((row) => row.id === b.auditId)).toBe(false);
    expect(data?.every((row) => row.org_id === a.orgId)).toBe(true);
  });

  it("forbids an authenticated user from writing audit_log rows (append-only, system-written)", async () => {
    const userA = await signedInClient(a.email);
    const { error } = await userA.from("audit_log").insert({
      org_id: a.orgId,
      actor: "forged-by-user",
      action: "tamper",
      entity: "checkin",
      entity_id: a.checkinId,
    });
    expect(error).not.toBeNull(); // RLS denies — there is no user INSERT policy
  });
});

describe.skipIf(!ready)("schema — safety item designation (ADR-0010)", () => {
  it("designates exactly the seeded safety item via the is_safety_item column", async () => {
    const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    // Scope to the seeded screener so unrelated test fixtures don't affect the count.
    const { data, error } = await admin
      .from("screener_items")
      .select("id, is_safety_item")
      .eq("screener_id", "20000000-0000-0000-0000-000000000001");
    expect(error).toBeNull();
    const flagged = (data ?? []).filter((row) => row.is_safety_item);
    expect(flagged.length).toBe(1);
    expect(flagged[0].id).toBe("30000000-0000-0000-0000-000000000006");
  });
});
