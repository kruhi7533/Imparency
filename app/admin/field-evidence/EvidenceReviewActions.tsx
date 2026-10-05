"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function EvidenceReviewActions({ evidenceId }: { evidenceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "APPROVE" | "REQUEST_RESUBMIT" | "REJECT") => {
    let note: string | null = null;
    if (decision !== "APPROVE") {
      note = prompt(decision === "REJECT" ? "Why is this rejected?" : "What should the field worker capture again?");
      if (!note) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/field-evidence/${evidenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <button onClick={() => decide("APPROVE")} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">
        Approve
      </button>
      <button onClick={() => decide("REQUEST_RESUBMIT")} disabled={busy} className="px-3 py-1.5 rounded-lg bg-orange-100 text-orange-800 text-xs font-bold disabled:opacity-50">
        Request resubmission
      </button>
      <button onClick={() => decide("REJECT")} disabled={busy} className="px-3 py-1.5 rounded-lg text-red-700 text-xs font-bold hover:bg-red-50 disabled:opacity-50">
        Reject
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
