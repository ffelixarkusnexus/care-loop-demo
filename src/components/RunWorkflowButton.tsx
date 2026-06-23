"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Invokes the run-workflow edge function with the clinician's session — the user
 * JWT is forwarded, so RLS applies inside the function (ADR-0006, on-demand path).
 */
export function RunWorkflowButton({ checkinId }: { checkinId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.functions.invoke("run-workflow", {
      body: { checkin_id: checkinId },
    });
    setBusy(false);
    if (error) {
      setMsg(`Error: ${error.message}`);
      return;
    }
    setMsg(`Workflow done — status: ${data?.status ?? "ok"}${data?.alert ? " · alert raised" : ""}`);
    router.refresh();
  }

  return (
    <div>
      <button className="primary" onClick={run} disabled={busy}>
        {busy ? "Running…" : "Run workflow"}
      </button>
      {msg && <div className="note">{msg}</div>}
    </div>
  );
}
