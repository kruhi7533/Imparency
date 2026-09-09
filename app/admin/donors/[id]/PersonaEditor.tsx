"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PERSONAS = ["INDIVIDUAL", "CSR_OFFICER", "HNI", "FOUNDATION", "GOVERNMENT"] as const;

/**
 * Set a donor's persona.
 *
 * The only place this can be done — onboarding collects a persona for
 * individuals but there was never an admin correction path, even though
 * persona now gates whether a donor can fund an opportunity
 * (lib/matching/funder.ts requires CSR_OFFICER, FOUNDATION or GOVERNMENT).
 */
export default function PersonaEditor({
  donorId,
  current,
}: {
  donorId: string;
  current: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [persona, setPersona] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!persona) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/donors/${donorId}/persona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setEditing(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="mt-1 text-[11px] font-bold text-emerald-600 hover:underline"
      >
        {current ? "Change" : "Set persona"}
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1.5">
      {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}
      <select
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-900 dark:text-white"
      >
        <option value="" disabled>
          Select…
        </option>
        {PERSONAS.map((p) => (
          <option key={p} value={p}>
            {p.replace("_", " ")}
          </option>
        ))}
      </select>
      <div className="flex gap-1.5">
        <button
          onClick={() => {
            setEditing(false);
            setPersona(current ?? "");
            setError("");
          }}
          className="px-2 py-1 text-[11px] font-bold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
        >
          Cancel
        </button>
        <button
          disabled={busy || !persona || persona === current}
          onClick={save}
          className="px-2 py-1 text-[11px] font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
