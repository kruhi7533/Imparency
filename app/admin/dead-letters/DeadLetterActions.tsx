"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/** Inspect / Replay once / Dismiss for one dead letter. */
export default function DeadLetterActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "replay" | "dismiss" | "inspect">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [detail, setDetail] = useState<unknown>(null);

  const call = async (kind: "replay" | "dismiss") => {
    if (kind === "replay" && !window.confirm("Replay this once? It cannot be replayed a second time.")) return;
    setBusy(kind);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/dead-letters/${id}/${kind}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIsError(true);
        setMessage(data.error || data.result?.error || `Failed (${res.status})`);
      } else {
        setIsError(false);
        setMessage(kind === "replay" ? "Replayed." : "Dismissed.");
      }
      router.refresh();
    } catch (e: any) {
      setIsError(true);
      setMessage(e.message);
    } finally {
      setBusy(null);
    }
  };

  const inspect = async () => {
    if (detail) return setDetail(null);
    setBusy("inspect");
    try {
      const res = await fetch(`/api/admin/dead-letters/${id}`);
      const data = await res.json().catch(() => ({}));
      setDetail(res.ok ? data.source ?? { note: "Source row no longer exists." } : { error: data.error });
    } finally {
      setBusy(null);
    }
  };

  const btn = "min-h-[34px] rounded-lg border px-3 text-xs font-bold disabled:opacity-50";
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={inspect} disabled={busy !== null} className={`${btn} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`}>
          {detail ? "Hide" : busy === "inspect" ? "Loading…" : "Inspect"}
        </button>
        {status === "OPEN" && (
          <button type="button" onClick={() => call("replay")} disabled={busy !== null} className={`${btn} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}>
            {busy === "replay" ? "Replaying…" : "Replay once"}
          </button>
        )}
        {(status === "OPEN" || status === "REPLAY_FAILED") && (
          <button type="button" onClick={() => call("dismiss")} disabled={busy !== null} className={`${btn} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`}>
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
        )}
      </div>
      {message && (
        <span role="status" className={`text-xs ${isError ? "text-red-600" : "text-emerald-600"}`}>
          {message}
        </span>
      )}
      {detail !== null && (
        <pre className="max-w-md overflow-x-auto rounded bg-gray-50 p-2 text-left text-[11px] text-gray-700 dark:bg-gray-950 dark:text-gray-300">{JSON.stringify(detail, null, 2)}</pre>
      )}
    </div>
  );
}
