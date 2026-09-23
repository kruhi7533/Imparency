"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The human gate on a proposal.
 *
 * Approve is deliberately terminal and has no undo here: an approved proposal
 * is what a funded project gets built from, and an approval that can be taken
 * back after money has moved is not an approval. Rejection demands a reason,
 * because the organisation is told it.
 */
export default function ProposalActions({
  proposalId,
  status,
}: {
  proposalId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function act(action: "START_REVIEW" | "APPROVE" | "REJECT") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update this proposal");
      setRejecting(false);
      setNote("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (status === "APPROVED" || status === "REJECTED" || status === "WITHDRAWN") {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        This proposal is {status.toLowerCase()} and can no longer be changed.
      </p>
    );
  }

  if (status === "DRAFT") {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Still a draft with the organisation. Nothing to review until they submit it.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {status === "SUBMITTED" && (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => act("START_REVIEW")}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "START_REVIEW" ? "Taking it up…" : "Take up for review"}
        </button>
      )}

      {status === "UNDER_REVIEW" && !rejecting && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act("APPROVE")}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "APPROVE" ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => setRejecting(true)}
            className="rounded-lg border border-red-200 dark:border-red-900/40 px-4 py-2 text-sm font-bold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Reject
          </button>
        </div>
      )}

      {status === "UNDER_REVIEW" && rejecting && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Why is this being rejected? The organisation is told this."
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!!busy || !note.trim()}
              onClick={() => act("REJECT")}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy === "REJECT" ? "Rejecting…" : "Confirm rejection"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                setRejecting(false);
                setNote("");
              }}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
