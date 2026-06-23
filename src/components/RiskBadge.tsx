const LABEL: Record<string, string> = {
  stable: "Stable",
  action_required: "Action Required",
  urgent: "Urgent",
};

export function RiskBadge({ tier }: { tier: string | null | undefined }) {
  const t = tier && tier in LABEL ? tier : "stable";
  return <span className={`badge ${t}`}>{LABEL[t]}</span>;
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const label =
    status === "final" ? "Final (signed off)"
      : status === "staged_for_review" ? "Staged for review"
      : status === "needs_manual_review" ? "Needs manual review"
      : status ?? "—";
  return <span className="badge status">{label}</span>;
}
