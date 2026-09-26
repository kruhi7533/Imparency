"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Repair action: tell a shortlisted organisation that was never told.
 *
 * Shown only when a SHORTLISTED candidate has no opportunity thread — either it
 * was decided before notification existed, or the send failed. A shortlist the
 * organisation never hears about is the exact failure this path prevents, so it
 * is surfaced on the row rather than left to a log nobody reads.
 */
export default function NotifyButton({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function notify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/matching/candidates/${candidateId}/notify`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not notify this organisation");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Shortlisted, but this organisation has not been told.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={notify}
        className="mt-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Notify organisation"}
      </button>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
