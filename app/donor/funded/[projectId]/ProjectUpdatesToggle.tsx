"use client";

import React, { useState } from "react";

/** Account-wide switch for milestone / verified-evidence update messages. */
export default function ProjectUpdatesToggle({ initialOn }: { initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/donor/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectUpdates: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save your preference");
      setOn(data.projectUpdates);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-xs text-gray-600 dark:text-gray-400">
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} className="accent-emerald-600" />
        Notify me when milestones or field updates are verified (all funded projects)
      </label>
      {!on && <p className="mt-1 text-gray-400">Updates are off. This page still shows everything.</p>}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}
