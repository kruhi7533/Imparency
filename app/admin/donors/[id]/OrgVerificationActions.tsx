"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Approve or reject a donor ORGANISATION on the donor 360 page.
 *
 * Shaped on PanActions next door, with one deliberate difference: when the
 * server refuses an approval because the profile is incomplete, the missing
 * fields are listed rather than folded into a generic error. "Cannot approve"
 * with no cause is a dead end; "missing CIN and annual CSR budget" is a thing
 * the admin can go and chase.
 */
export default function OrgVerificationActions({
  donorId,
  status,
}: {
  donorId: string;
  status: "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";
}) {
  const router = useRouter();
  const [action, setAction] = useState<"VERIFY" | "REJECT" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [result, setResult] = useState("");

  // Only a profile awaiting review can be decided — the same rule the route
  // enforces, surfaced here so the buttons are not offered on a dead state.
  if (status !== "PENDING") {
    return (
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {status === "NOT_SUBMITTED"
          ? "No organisation profile submitted — nothing to review."
          : status === "VERIFIED"
            ? "This organisation is verified. It returns here automatically if its name or CIN changes."
            : "This organisation was rejected. It returns here once the donor completes their profile."}
      </p>
    );
  }

  async function submit() {
    if (!action || !note.trim()) return;
    setBusy(true);
    setError("");
    setMissing([]);
    try {
      const res = await fetch(`/api/admin/donors/${donorId}/org-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.missing)) setMissing(data.missing);
        throw new Error(data.error || "Failed");
      }
      setResult(
        action === "VERIFY"
          ? "Organisation verified. The donor has been notified."
          : "Organisation rejected. The donor has been notified and can resubmit."
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
      {missing.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-red-600">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {result && <p className="text-xs font-semibold text-emerald-600">{result}</p>}

      {!action ? (
        <div className="flex gap-2">
          <button
            onClick={() => setAction("VERIFY")}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
          >
            Verify Organisation
          </button>
          <button
            onClick={() => setAction("REJECT")}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
          >
            Reject
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
                ? "What did you check to confirm this company exists? (recorded in the audit log)"
                : "Reason for rejecting — the donor will see this."
            }
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setAction(null); setNote(""); setError(""); setMissing([]); }}
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
              {busy ? "Working…" : action === "VERIFY" ? "Confirm Verification" : "Confirm Rejection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
