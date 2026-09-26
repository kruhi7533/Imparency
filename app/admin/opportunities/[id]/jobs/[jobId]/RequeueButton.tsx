"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-run a finished job, or recover one stranded in RUNNING.
 *
 * Safe by construction: candidates upsert on (jobId, ngoId) and the update
 * omits every decision column, so a re-run refreshes the engine's proposal
 * without disturbing any shortlisting already done.
 */
export default function RequeueButton({ jobId, label }: { jobId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requeue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/matching/jobs/${jobId}/requeue`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not re-run this job");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={requeue}
        className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? "Running…" : label}
      </button>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
