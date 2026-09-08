"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The human gate, per candidate.
 *
 * Shortlisting an organisation the engine did not find eligible is allowed —
 * an admin may know something the rules do not — but it is never silent: the
 * note box opens automatically and the API refuses the write without one.
 */
export default function CandidateDecision({
  candidateId,
  verdict,
}: {
  candidateId: string;
  verdict: string;
}) {
  const router = useRouter();
  const isOverride = verdict !== "ELIGIBLE";
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function decide(action: "SHORTLIST" | "DISMISS") {
    if (action === "SHORTLIST" && isOverride && !note.trim()) {
      setShowNote(true);
      setError("The engine did not find this organisation eligible. Say why you are shortlisting it.");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/matching/candidates/${candidateId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That did not work");

      // The decision is saved either way. If the message did not go out, the
      // admin has to know — silently assuming it did is how an organisation
      // ends up shortlisted and never told.
      if (action === "SHORTLIST" && !data.notifiedThreadId) {
        setWarning(
          "Shortlisted, but the organisation could not be notified. Open an inquiry thread with them manually."
        );
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3">
      {(showNote || (isOverride && note)) && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Why is this organisation being shortlisted despite the engine's verdict?"
          className="mb-2 w-full rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => decide("SHORTLIST")}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "SHORTLIST" ? "Saving…" : isOverride ? "Shortlist anyway" : "Shortlist"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => decide("DISMISS")}
          className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {busy === "DISMISS" ? "Saving…" : "Dismiss"}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-600">
        Shortlisting emails the organisation and opens a thread it can reply on. Dismissing tells
        them nothing.
      </p>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {warning && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{warning}</p>}
    </div>
  );
}
