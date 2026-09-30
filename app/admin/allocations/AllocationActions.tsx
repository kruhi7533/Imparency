"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The two money decisions on this page: propose a commitment, and decide one.
 *
 * Local useState + router.refresh(), the repo's only client-state pattern. No
 * optimistic update anywhere here — showing money as committed before the
 * server agreed is precisely the lie this module exists to prevent.
 */

export function ProposeAllocationForm({
  proposalId,
  requestedAmount,
  remaining,
}: {
  proposalId: string;
  requestedAmount: string;
  /** Null when the opportunity has no budget recorded. */
  remaining: string | null;
}) {
  const router = useRouter();
  // Pre-filled with what was asked for: full funding is the common case, and
  // the admin edits down when it is not.
  const [amount, setAmount] = useState(requestedAmount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not propose this allocation.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (remaining === null) {
    return (
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
        This opportunity has no budget recorded, so nothing can be committed against it yet.
      </p>
    );
  }

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="text-xs font-bold text-gray-500 dark:text-gray-400">
        Commit
        <div className="mt-1 flex items-center gap-1">
          <span className="text-sm text-gray-400">₹</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-36 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white"
          />
        </div>
      </label>
      <button
        onClick={propose}
        disabled={busy || amount.trim().length === 0}
        className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-bold disabled:opacity-50"
      >
        {busy ? "Saving…" : "Propose allocation"}
      </button>
      <span className="text-xs text-gray-400">₹{remaining} left of the budget</span>
      {error && <p className="w-full text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function AllocationDecision({ allocationId }: { allocationId: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "APPROVE" | "REJECT") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/allocations/${allocationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not record this decision.");
        return;
      }
      setRejecting(false);
      setNote("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => decide("APPROVE")}
          disabled={busy || rejecting}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
        >
          {busy && !rejecting ? "Committing…" : "Approve commitment"}
        </button>
        <button
          onClick={() => setRejecting((v) => !v)}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300"
        >
          Reject
        </button>
      </div>
      {rejecting && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Why is this not being funded? (required — the organisation is told this)"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
          <button
            onClick={() => decide("REJECT")}
            disabled={busy || note.trim().length === 0}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50"
          >
            {busy ? "Saving…" : "Confirm rejection"}
          </button>
        </div>
      )}
      {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
