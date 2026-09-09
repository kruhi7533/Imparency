"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Open / close an opportunity, and start a matching run.
 *
 * "Run matching" is disabled unless the opportunity is open and no run is
 * already in flight — the API enforces both, but a disabled button explains the
 * rule before the click rather than after it.
 */
export default function OpportunityActions({
  opportunityId,
  status,
  criteriaCount,
  hasInFlightJob,
}: {
  opportunityId: string;
  status: string;
  criteriaCount: number;
  hasInFlightJob: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);

  async function call(url: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method: url.includes("/jobs") ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That did not work");
      if (data.jobId) {
        router.push(`/admin/opportunities/${opportunityId}/jobs/${data.jobId}`);
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const canRun = status === "OPEN" && criteriaCount > 0 && !hasInFlightJob;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(status === "DRAFT" || status === "SUBMITTED") && (
          <>
            <button
              type="button"
              disabled={busy !== null || criteriaCount === 0}
              onClick={() =>
                call(`/api/admin/matching/opportunities/${opportunityId}`, { action: "APPROVE" }, "open")
              }
              title={criteriaCount === 0 ? "Add at least one criterion first" : undefined}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "open" ? "Opening…" : status === "SUBMITTED" ? "Approve & open" : "Open"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setShowReject((v) => !v)}
              className="rounded-lg border border-red-200 dark:border-red-900 px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}

        {status === "OPEN" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              call(`/api/admin/matching/opportunities/${opportunityId}`, { action: "CLOSE" }, "close")
            }
            className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {busy === "close" ? "Closing…" : "Close"}
          </button>
        )}

        <button
          type="button"
          disabled={!canRun || busy !== null}
          onClick={() => call("/api/admin/matching/jobs", { opportunityId }, "run")}
          title={
            status !== "OPEN"
              ? "Only an open opportunity can be matched"
              : hasInFlightJob
                ? "A run is already in progress"
                : undefined
          }
          className="rounded-lg bg-gray-900 dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 hover:opacity-90 disabled:opacity-40"
        >
          {busy === "run" ? "Running…" : "Run matching"}
        </button>
      </div>

      {showReject && (
        <div className="mt-3 max-w-xl">
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={2}
            placeholder="Why is this being rejected? The donor will be told."
            className="w-full rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
          <button
            type="button"
            disabled={busy !== null || !rejectNote.trim()}
            onClick={() =>
              call(
                `/api/admin/matching/opportunities/${opportunityId}`,
                { action: "REJECT", note: rejectNote.trim() },
                "reject"
              )
            }
            className="mt-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy === "reject" ? "Rejecting…" : "Confirm rejection"}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
