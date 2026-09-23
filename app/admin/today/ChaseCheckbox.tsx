"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "I've chased them" — the one control on Today that writes anything.
 *
 * Ticking it hides the item for a week; unticking brings it straight back. It
 * deliberately does not resolve or complete anything: the organisation still
 * owes the work, and pretending otherwise would lose it.
 *
 * Stops the click from reaching the surrounding card link, which would
 * otherwise navigate away the moment the box is ticked.
 */
export default function ChaseCheckbox({
  itemKey,
  chased,
  chasedUntil,
}: {
  itemKey: string;
  chased: boolean;
  chasedUntil?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(e: React.MouseEvent | React.ChangeEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/today/chase", {
        method: chased ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not record that");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={chased}
          disabled={busy}
          onChange={toggle}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
        />
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {busy
            ? "Saving…"
            : chased
              ? `Chased${chasedUntil ? ` · back ${chasedUntil}` : ""}`
              : "I've chased this"}
        </span>
      </label>
      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
