"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Approve / return / reject one outcome claim.
 *
 * When the triage verdict is BLOCKED, Approve is not rendered at all — but
 * that is a courtesy, not the control. The route refuses a blocked approval
 * with a 422 regardless of what the client sends
 * (app/api/admin/outcome-claims/[id]/route.ts), because a gate that lives in a
 * React component is not a gate.
 *
 * A NEEDS_REVIEW claim CAN be approved: those findings are questions, not
 * verdicts, and a human is allowed to answer them. The approval is recorded
 * with the verdict and finding codes, so "approved over a finding" is
 * measurable later — the same reasoning as `overrodeAi` on field validation.
 */
export default function ImpactClaimActions({
  claimId,
  blocked,
  needsReview,
}: {
  claimId: string;
  blocked: boolean;
  needsReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<"REQUEST_EVIDENCE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");

  async function act(action: "APPROVE" | "REQUEST_EVIDENCE" | "REJECT") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/outcome-claims/${claimId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `Could not apply that (${res.status}).`);
        return;
      }
      setNoteFor(null);
      setNote("");
      router.refresh();
    } catch {
      setError("Network error — nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  if (noteFor) {
    const rejecting = noteFor === "REJECT";
    return (
      <div className="w-full max-w-sm space-y-2">
        <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-500">
          {rejecting ? "Why this number should not be reported" : "What evidence is missing"}
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          placeholder={
            rejecting
              ? "The organisation has to be able to answer this."
              : "Name what to cite, so they can fix it and resubmit."
          }
          className="w-full rounded-lg border border-gray-300 p-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              setNoteFor(null);
              setNote("");
              setError(null);
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={() => act(noteFor)}
            disabled={note.trim().length < 10 || busy !== null}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
              rejecting ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
            }`}
          >
            {busy ? "Working…" : rejecting ? "Reject claim" : "Return for evidence"}
          </button>
        </div>
        {note.trim().length > 0 && note.trim().length < 10 && (
          <p className="text-[10px] text-gray-500 dark:text-gray-500">
            At least 10 characters — a decision with no reason cannot be answered.
          </p>
        )}
        {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {!blocked && (
          <button
            onClick={() => act("APPROVE")}
            disabled={busy !== null}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "APPROVE" ? "Working…" : needsReview ? "Approve anyway" : "Approve"}
          </button>
        )}
        <button
          onClick={() => setNoteFor("REQUEST_EVIDENCE")}
          disabled={busy !== null}
          className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-900/40 dark:text-amber-400 dark:hover:bg-amber-950/30"
        >
          Return for evidence
        </button>
        <button
          onClick={() => setNoteFor("REJECT")}
          disabled={busy !== null}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Reject
        </button>
      </div>
      {blocked && (
        <p className="max-w-xs text-right text-[10px] text-red-600 dark:text-red-400">
          Approval is unavailable while a blocking check fails. Return it for evidence.
        </p>
      )}
      {error && <p className="max-w-xs text-right text-[10px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
