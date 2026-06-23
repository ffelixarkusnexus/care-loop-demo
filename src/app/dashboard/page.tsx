import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RiskBadge, StatusBadge } from "@/components/RiskBadge";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

const TIER_RANK: Record<string, number> = { urgent: 0, action_required: 1, stable: 2 };

type SummaryRow = {
  risk_tier: string | null;
  status: string | null;
  checkins: { member_user_id: string; created_at: string } | { member_user_id: string; created_at: string }[] | null;
};

export default async function Dashboard() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Patients in the clinician's org (RLS-scoped) ...
  const { data: members } = await supabase.from("memberships").select("user_id").eq("role", "member");

  // ... and every summary the clinician can see (summaries has no created_at;
  // recency comes from the embedded check-in's timestamp).
  const { data: summaries } = await supabase
    .from("summaries")
    .select("risk_tier, status, checkins(member_user_id, created_at)");

  // Latest summary per patient, by the check-in timestamp.
  const latestByMember = new Map<string, { risk_tier: string | null; status: string | null; at: string }>();
  for (const s of (summaries ?? []) as SummaryRow[]) {
    const c = Array.isArray(s.checkins) ? s.checkins[0] : s.checkins;
    if (!c?.member_user_id) continue;
    const prev = latestByMember.get(c.member_user_id);
    if (!prev || c.created_at > prev.at) {
      latestByMember.set(c.member_user_id, { risk_tier: s.risk_tier, status: s.status, at: c.created_at });
    }
  }

  const rows = (members ?? [])
    .map((m) => {
      const s = latestByMember.get(m.user_id);
      return {
        member: m.user_id,
        risk_tier: s?.risk_tier ?? null,
        status: s?.status ?? null,
        reviewed: Boolean(s),
      };
    })
    .sort((a, b) => (TIER_RANK[a.risk_tier ?? ""] ?? 3) - (TIER_RANK[b.risk_tier ?? ""] ?? 3));

  return (
    <>
      <div className="topbar">
        <h1>Care Loop — triage</h1>
        <span className="who">
          {user.email} · <LogoutButton />
        </span>
      </div>
      <div className="shell">
        <div className="banner">
          Demo on synthetic data — not clinical software, no medical advice. The risk tier is computed in code;
          the AI draft is validated by a deterministic gate and a clinician signs off before <code>final</code>.
        </div>
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Risk tier</th>
                <th>Review status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No patients visible for this org.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.member}>
                  <td>Patient {r.member.slice(0, 8)}…{r.member.slice(-2)}</td>
                  <td>{r.reviewed ? <RiskBadge tier={r.risk_tier} /> : <span className="muted">not yet run</span>}</td>
                  <td>{r.reviewed ? <StatusBadge status={r.status} /> : <span className="muted">—</span>}</td>
                  <td>
                    <Link href={`/patients/${r.member}`}>Review →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
