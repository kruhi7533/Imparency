"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/** "Run now" for one registered job. The run is recorded in the ledger as MANUAL. */
export default function RunJobButton({ job, label }: { job: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const run = async () => {
    if (!window.confirm(`Run "${label}" now? It is safe to re-run; a run already in progress is skipped.`)) return;
    setState("running");
    setMessage("");
    try {
      const res = await fetch(`/api/admin/ops/${job}/run`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.result?.error || `Job returned ${data.status ?? res.status}`);
      setState("done");
      setMessage(data.result?.skipped ? "Skipped — another run was in progress." : "Finished.");
      router.refresh();
    } catch (e: any) {
      setState("error");
      setMessage(e.message);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="min-h-[36px] rounded-lg border border-gray-300 px-3 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        {state === "running" ? "Running…" : "Run now"}
      </button>
      <span role="status" aria-live="polite" className={`ml-2 text-xs ${state === "error" ? "text-red-600" : "text-gray-500"}`}>
        {message}
      </span>
    </div>
  );
}
