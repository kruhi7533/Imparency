"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin decisions on payment → milestone allocation lines (requirement →
 * contract flow). Server enforces every rule; this only calls the API and
 * refreshes. No optimistic update.
 */

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? null : data?.error ?? "Request failed.";
  } catch {
    return "Could not reach the server.";
  }
}

export function AllocationLineDecision({ allocationId, canApprove }: { allocationId: string; canApprove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  async function decide(action: "APPROVE" | "REJECT") {
    setBusy(true);
    setError(null);
    const err = await send(`/api/admin/contract-allocations/${allocationId}`, "PATCH", { action, note: action === "REJECT" ? note : undefined });
    setBusy(false);
    if (err) return setError(err);
    setRejecting(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!rejecting ? (
        <div className="flex gap-1">
          <button
            onClick={() => decide("APPROVE")}
            disabled={busy || !canApprove}
            title={canApprove ? "" : "Only reconciled money can be approved onto a milestone"}
            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-40"
          >
            Approve
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="px-2.5 py-1 rounded-lg text-red-600 text-[11px] font-bold hover:bg-red-50 disabled:opacity-40"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="flex gap-1 items-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why? (required)"
            className="w-40 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
          />
          <button
            onClick={() => decide("REJECT")}
            disabled={busy || !note.trim()}
            className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[11px] font-bold disabled:opacity-40"
          >
            Confirm
          </button>
          <button onClick={() => setRejecting(false)} className="text-[11px] text-gray-500">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

export function ManualAllocationForm({
  paymentId,
  unallocated,
  milestones,
}: {
  paymentId: string;
  unallocated: string;
  milestones: Array<{ id: string; title: string; room: string }>;
}) {
  const router = useRouter();
  const [milestoneId, setMilestoneId] = useState(milestones[0]?.id ?? "");
  const [amount, setAmount] = useState(unallocated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function allocate() {
    setBusy(true);
    setError(null);
    const err = await send("/api/admin/contract-allocations", "POST", { paymentId, contractMilestoneId: milestoneId, amount });
    setBusy(false);
    if (err) return setError(err);
    router.refresh();
  }

  if (milestones.length === 0) return <p className="text-[11px] text-gray-500">No milestone has room left.</p>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        value={milestoneId}
        onChange={(e) => setMilestoneId(e.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
      >
        {milestones.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title} (room ₹{m.room})
          </option>
        ))}
      </select>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        className="w-28 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
      />
      <button
        onClick={allocate}
        disabled={busy || !milestoneId || !amount.trim()}
        className="px-2.5 py-1 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-[11px] font-bold disabled:opacity-40"
      >
        {busy ? "Saving…" : "Allocate"}
      </button>
      {error && <p className="w-full text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
