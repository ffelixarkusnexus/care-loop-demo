"use client";

import { useState } from "react";
import { approveSummary, editSummary, rejectSummary } from "@/app/patients/[id]/actions";

export function ReviewActions({
  summaryId,
  orgId,
  patientId,
  summaryMd,
  isFinal,
}: {
  summaryId: string;
  orgId: string;
  patientId: string;
  summaryMd: string;
  isFinal: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (isFinal) {
    return (
      <p className="note">
        Signed off — status is <strong>final</strong>. No further changes.
      </p>
    );
  }

  const hidden = (
    <>
      <input type="hidden" name="summaryId" value={summaryId} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="patientId" value={patientId} />
    </>
  );

  return (
    <>
      <div className="actions">
        <form action={approveSummary}>
          {hidden}
          <button className="primary" type="submit">
            Approve → final
          </button>
        </form>
        <button type="button" onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel edit" : "Edit"}
        </button>
        <form action={rejectSummary}>
          {hidden}
          <button className="danger" type="submit">
            Reject
          </button>
        </form>
      </div>
      {editing && (
        <form action={editSummary} style={{ marginTop: 12 }}>
          {hidden}
          <textarea name="summaryMd" defaultValue={summaryMd} />
          <div className="actions">
            <button className="primary" type="submit">
              Save edit
            </button>
          </div>
        </form>
      )}
    </>
  );
}
