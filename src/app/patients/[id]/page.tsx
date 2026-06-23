import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RiskBadge, StatusBadge } from "@/components/RiskBadge";
import { LogoutButton } from "@/components/LogoutButton";
import { RunWorkflowButton } from "@/components/RunWorkflowButton";
import { ReviewActions } from "@/components/ReviewActions";

export const dynamic = "force-dynamic";

type ItemEmbed = { id: string; prompt: string; max_score: number; is_safety_item: boolean };
type ResultRow = { score: number; item_id: string; screener_items: ItemEmbed | ItemEmbed[] | null };

export default async function PatientReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: checkins } = await supabase
    .from("checkins")
    .select("id, org_id, member_user_id, mood, note, created_at")
    .eq("member_user_id", id)
    .order("created_at", { ascending: false });

  if (!checkins || checkins.length === 0) {
    return (
      <>
        <Topbar email={user.email} />
        <div className="shell">
          <p className="muted">No check-ins visible for this patient in your org.</p>
          <Link href="/dashboard">← Back to triage</Link>
        </div>
      </>
    );
  }

  const latest = checkins[0];
  const orgId = latest.org_id;

  const { data: resultsRaw } = await supabase
    .from("screener_results")
    .select("score, item_id, screener_items(id, prompt, max_score, is_safety_item)")
    .eq("member_user_id", id)
    .order("created_at", { ascending: false });

  const seen = new Set<string>();
  const items = ((resultsRaw ?? []) as unknown as ResultRow[])
    .map((r) => {
      const si = Array.isArray(r.screener_items) ? r.screener_items[0] : r.screener_items;
      return si ? { item_id: r.item_id, ...si, score: r.score } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter((x) => (seen.has(x.item_id) ? false : (seen.add(x.item_id), true)));
  const itemById = new Map(items.map((i) => [i.item_id, i]));

  const { data: summary } = await supabase
    .from("summaries")
    .select("id, risk_tier, model, summary_md, cited_item_ids, status")
    .eq("checkin_id", latest.id)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: assessment } = await supabase
    .from("assessments")
    .select("model_risk, confidence")
    .eq("checkin_id", latest.id)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const cited = Array.isArray(summary?.cited_item_ids) ? (summary!.cited_item_ids as string[]) : [];

  return (
    <>
      <Topbar email={user.email} />
      <div className="shell">
        <p>
          <Link href="/dashboard">← Back to triage</Link> · Patient {id.slice(0, 8)}…{id.slice(-2)}
        </p>
        <div className="dual">
          {/* Left: the real data */}
          <div className="card pane">
            <h2>Check-in &amp; screener history</h2>
            <div className="item">
              <strong>Latest check-in</strong>
              <span className="score">mood {latest.mood ?? "—"}</span>
              <div>{latest.note ?? <span className="muted">(no note)</span>}</div>
              <div className="label">{fmt(latest.created_at)}</div>
            </div>

            <h2 style={{ marginTop: 18 }}>Screener items</h2>
            {items.map((i) => (
              <div key={i.item_id} id={`item-${i.item_id}`} className={`item${i.is_safety_item ? " safety" : ""}`}>
                <span className="score">
                  {i.score}/{i.max_score}
                </span>
                <div>
                  {i.prompt}
                  {i.is_safety_item && <span className="label"> · safety item</span>}
                </div>
                <div className="label">item …{i.item_id.slice(-4)}</div>
              </div>
            ))}

            <h2 style={{ marginTop: 18 }}>Recent check-ins</h2>
            {checkins.slice(0, 7).map((c) => (
              <div key={c.id} className="label">
                {fmt(c.created_at)} — mood {c.mood ?? "—"}
              </div>
            ))}
          </div>

          {/* Right: the AI draft + sign-off */}
          <div className="card pane">
            <h2>AI-drafted clinician summary</h2>
            {!summary ? (
              <>
                <p className="muted">No draft yet for the latest check-in.</p>
                <RunWorkflowButton checkinId={latest.id} />
              </>
            ) : (
              <>
                <div>
                  <RiskBadge tier={summary.risk_tier} /> <StatusBadge status={summary.status} />
                </div>
                <div className="note">
                  Official tier (computed in code): <strong>{summary.risk_tier}</strong>
                  {assessment?.model_risk && (
                    <>
                      {" "}
                      · model suggested: {assessment.model_risk} ({assessment.confidence})
                    </>
                  )}
                </div>
                {summary.model === "seed" && (
                  <div className="note">Illustrative seeded draft — re-run the workflow for a live model draft.</div>
                )}

                <div className="summary-md" style={{ marginTop: 12 }}>
                  {summary.summary_md}
                </div>

                {cited.length > 0 && (
                  <div className="cited">
                    <div className="label">Cited items (jump to source):</div>
                    {cited.map((cid) => (
                      <a key={cid} href={`#item-${cid}`}>
                        {itemById.get(cid)?.prompt ?? `item ${cid.slice(0, 8)}`}
                      </a>
                    ))}
                  </div>
                )}

                <ReviewActions
                  summaryId={summary.id}
                  orgId={orgId}
                  patientId={id}
                  summaryMd={summary.summary_md ?? ""}
                  isFinal={summary.status === "final"}
                />

                <div style={{ marginTop: 16 }}>
                  <RunWorkflowButton checkinId={latest.id} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Topbar({ email }: { email?: string }) {
  return (
    <div className="topbar">
      <h1>Care Loop — patient review</h1>
      <span className="who">
        {email} · <LogoutButton />
      </span>
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}
