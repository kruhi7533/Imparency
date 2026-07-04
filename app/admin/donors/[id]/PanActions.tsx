"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/** Manual PAN verify/reject buttons on the donor 360 page. A written note is mandatory. */
export default function PanActions({ donorId }: { donorId: string }) {
  const router = useRouter();
  const [action, setAction] = useState<"VERIFY" | "REJECT" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function submit() {
    if (!action || !note.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/donors/${donorId}/pan-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setResult(
        action === "VERIFY"
          ? `PAN verified manually.${data.receiptsIssued ? ` ${data.receiptsIssued} withheld receipt(s) issued.` : ""}`
          : "PAN marked as failed. The donor has been notified."
      );
      setAction(null);
      setNote("");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      {result && <p className="text-xs font-semibold text-emerald-600">{result}</p>}

      {!action ? (
        <div className="flex gap-2">
          <button
            onClick={() => setAction("VERIFY")}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
          >
            Verify Manually
          </button>
          <button
            onClick={() => setAction("REJECT")}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
          >
            Reject PAN
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={
              action === "VERIFY"
                ? "Justification — what did you check to verify this PAN manually? (recorded in the audit log)"
                : "Reason for rejecting — the donor will see this."
            }
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setAction(null); setNote(""); }}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              Cancel
            </button>
            <button
              disabled={busy || !note.trim()}
              onClick={submit}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg text-white transition disabled:opacity-50 ${
                action === "VERIFY" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {busy ? "Working…" : action === "VERIFY" ? "Confirm Manual Verification" : "Confirm Rejection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
