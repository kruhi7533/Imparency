"use client";

import React, { useState } from "react";

type Decision = "APPROVE" | "REQUEST_RESUBMIT" | "REJECT";

const LABEL: Record<Decision, string> = {
  APPROVE: "Approve",
  REQUEST_RESUBMIT: "Return to NGO",
  REJECT: "Reject",
};

/**
 * Approve / return for rework / reject. A note is required to return or
 * reject, and to approve a flagged photo (the server enforces both; the form
 * just asks up front).
 */
export default function EvidenceReviewActions({
  evidenceId,
  flagged = false,
  onDone,
}: {
  evidenceId: string;
  flagged?: boolean;
  onDone?: () => void;
}) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNote = (d: Decision) => d !== "APPROVE" || flagged;

  const submit = async (decision: Decision) => {
    if (needsNote(decision) && note.trim().length < 5) {
      setPending(decision);
      setError("Add a note of at least 5 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/field-evidence/${evidenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      setPending(null);
      setNote("");
      onDone?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const choose = (d: Decision) => {
    setError(null);
    if (!needsNote(d)) return submit(d);
    if (pending === d) return submit(d);
    setPending(d);
  };

  return (
    <div className="space-y-2 pt-1">
      {pending && (
        <label className="block text-xs text-gray-700">
          {pending === "APPROVE"
            ? "This photo is flagged. Why are you approving it anyway?"
            : pending === "REJECT"
            ? "Why is this rejected?"
            : "What should the field worker capture again?"}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => choose("APPROVE")} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">
          {pending === "APPROVE" ? "Confirm approve" : flagged ? "Approve (override flag)" : LABEL.APPROVE}
        </button>
        <button onClick={() => choose("REQUEST_RESUBMIT")} disabled={busy} className="px-3 py-1.5 rounded-lg bg-orange-100 text-orange-800 text-xs font-bold disabled:opacity-50">
          {pending === "REQUEST_RESUBMIT" ? "Confirm return" : LABEL.REQUEST_RESUBMIT}
        </button>
        <button onClick={() => choose("REJECT")} disabled={busy} className="px-3 py-1.5 rounded-lg text-red-700 text-xs font-bold hover:bg-red-50 disabled:opacity-50">
          {pending === "REJECT" ? "Confirm reject" : LABEL.REJECT}
        </button>
        {pending && (
          <button
            onClick={() => {
              setPending(null);
              setError(null);
            }}
            disabled={busy}
            className="px-2 py-1.5 text-xs text-gray-500 underline"
          >
            Cancel
          </button>
        )}
        {busy && <span className="text-xs text-gray-500">Saving…</span>}
        {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}
