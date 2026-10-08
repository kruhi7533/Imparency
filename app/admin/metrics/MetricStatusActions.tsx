"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Activate / deprecate a metric.
 *
 * Deliberately the only mutation on this screen. Editing a definition changes
 * how every number already reported against the metric should be read, so it
 * goes through the API with a version bump rather than being an inline text
 * field someone can nudge — see app/api/admin/metrics/[code]/route.ts.
 *
 * No `node:` imports here or in anything it pulls in: this is a client
 * component, and tests/client-bundle-safety.test.ts enforces that boundary
 * after the Week 7 regression where a Node builtin reached the browser bundle
 * and took /admin/proof-review down with a 500.
 */
export default function MetricStatusActions({
  code,
  status,
  claimCount,
}: {
  code: string;
  status: string;
  claimCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: "ACTIVE" | "DEPRECATED") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/metrics/${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface the API's own reason — it explains WHY an activation was
        // refused (e.g. no evidence rule), which a generic message would lose.
        setError(
          data?.errors?.[0]?.message ?? data?.error ?? `Could not update (${res.status}).`
        );
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {status !== "ACTIVE" && (
          <button
            onClick={() => setStatus("ACTIVE")}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Working…" : "Activate"}
          </button>
        )}
        {status === "ACTIVE" && (
          <button
            onClick={() => setStatus("DEPRECATED")}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {busy ? "Working…" : "Deprecate"}
          </button>
        )}
      </div>
      {status === "ACTIVE" && claimCount > 0 && (
        <p className="text-[10px] text-gray-500 dark:text-gray-500">
          Deprecating keeps the {claimCount} existing claim{claimCount === 1 ? "" : "s"}.
        </p>
      )}
      {error && <p className="max-w-xs text-right text-[10px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
