"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The two things an admin can DO on the finance page: run the reconciler, and
 * close a finding.
 *
 * Local useState + router.refresh(), the repo's only client-state pattern —
 * no store, no optimistic update. An optimistic tick here would be actively
 * harmful: it would show a discrepancy as handled before the server agreed.
 */

export function RunReconciliationButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/reconcile", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Reconciliation failed. The run is recorded as failed, not clean.");
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={run}
        disabled={busy}
        className="px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-sm font-bold disabled:opacity-50"
      >
        {busy ? "Checking…" : "Run reconciliation"}
      </button>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

export function ResolveExceptionForm({ exceptionId }: { exceptionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/exceptions/${exceptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not resolve this exception.");
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-bold text-gray-600 underline underline-offset-2"
      >
        Resolve
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What was done about this? (required — and kept on the record)"
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={resolve}
          disabled={busy || note.trim().length === 0}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Confirm resolution"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-600"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Manually match an unmatched bank-statement credit (UNMATCHED_BANK_LINE) to
 * one of the NGO's pending contract payments. The server checks NGO, exact
 * amount and state; the note is required and audited.
 */
export function BankLineMatchForm({
  lineId,
  candidates,
}: {
  lineId: string;
  candidates: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [paymentId, setPaymentId] = useState(candidates[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function match() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/bank-lines/${lineId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not match this line.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (candidates.length === 0) {
    return (
      <p className="mt-2 text-xs text-gray-500">
        No pending contract payment for this NGO to match against. Resolve with a note if it is not a contract payment.
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select
        value={paymentId}
        onChange={(e) => setPaymentId(e.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
      >
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why this payment? (required)"
        className="flex-1 min-w-[180px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
      />
      <button
        onClick={match}
        disabled={busy || !paymentId || !note.trim()}
        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
      >
        {busy ? "Matching…" : "Match to payment"}
      </button>
      {error && <p className="w-full text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
