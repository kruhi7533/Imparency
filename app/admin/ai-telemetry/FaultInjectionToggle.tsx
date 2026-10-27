"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "timeout" | "error";
interface State {
  allowed: boolean;
  envMode: Mode | null;
  settingMode: Mode | null;
  effective: Mode | null;
}

/** AI-010: force every AI call to fail, to watch each caller degrade. */
export default function FaultInjectionToggle({ initial }: { initial: State }) {
  const router = useRouter();
  const [state, setState] = useState<State>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = async (mode: Mode | "off") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-telemetry/fault-injection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setState(data);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const active = state.effective;
  return (
    <section className={`mt-6 rounded-xl border p-5 ${active ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <h2 className="text-base font-bold text-gray-900">Fault injection</h2>
      <p className="mt-1 text-xs text-gray-600">
        Forces every AI call to fail as a timeout or an error so the fallback can be observed (e.g. submit a milestone
        proof or run project screening). Disabled in production.
      </p>
      {!state.allowed ? (
        <p className="mt-3 text-sm font-semibold text-gray-700">Not available: this server runs in production.</p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            Status:{" "}
            <span className={`font-semibold ${active ? "text-amber-700" : "text-emerald-700"}`}>
              {active ? `ON — every AI call fails as ${active.toUpperCase()}` : "off"}
            </span>
            {state.envMode && <span className="ml-2 text-xs text-gray-500">(set by AI_FAULT_INJECTION env; the toggle cannot override it)</span>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["timeout", "error"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy || state.settingMode === m}
                onClick={() => set(m)}
                className="min-h-[36px] rounded-lg border border-amber-400 px-3 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                Force {m}
              </button>
            ))}
            <button
              type="button"
              disabled={busy || !state.settingMode}
              onClick={() => set("off")}
              className="min-h-[36px] rounded-lg border border-gray-300 px-3 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
