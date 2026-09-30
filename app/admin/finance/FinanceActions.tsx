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
        className="px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-bold disabled:opacity-50"
      >
        {busy ? "Checking…" : "Run reconciliation"}
      </button>
      {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
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
        className="text-xs font-bold text-gray-600 dark:text-gray-300 underline underline-offset-2"
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
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
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
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
