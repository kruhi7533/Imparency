"use client";

import React, { useState } from "react";

/**
 * "Was this update useful?" — a donor's feedback on a project's updates.
 * Sends to PUT /api/donor/update-feedback; the NGO sees the counts and notes,
 * never who sent them.
 */
export default function UpdateFeedback({
  projectId,
  eventId,
  prompt = "Was this update useful?",
}: {
  projectId: string;
  eventId?: string;
  prompt?: string;
}) {
  const [signal, setSignal] = useState<"HELPFUL" | "NEED_MORE_DETAIL" | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const send = async (s: "HELPFUL" | "NEED_MORE_DETAIL", withNote = note) => {
    setSignal(s);
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/donor/update-feedback", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, eventId, signal: s, note: withNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send feedback.");
      setState("saved");
    } catch (e: any) {
      setState("error");
      setError(e.message);
    }
  };

  const btn = (active: boolean) =>
    `min-h-[40px] px-3 rounded-lg text-xs font-bold border ${
      active ? "border-emerald-400 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
    }`;
  const inputId = `fb-note-${eventId ?? projectId}`;

  return (
    <div className="mt-3 space-y-2">
      <div role="group" aria-label={prompt} className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">{prompt}</span>
        <button type="button" aria-pressed={signal === "HELPFUL"} onClick={() => send("HELPFUL")} className={btn(signal === "HELPFUL")}>
          Helpful
        </button>
        <button
          type="button"
          aria-pressed={signal === "NEED_MORE_DETAIL"}
          onClick={() => send("NEED_MORE_DETAIL")}
          className={btn(signal === "NEED_MORE_DETAIL")}
        >
          I&apos;d like more detail
        </button>
      </div>
      {signal === "NEED_MORE_DETAIL" && (
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="sr-only" htmlFor={inputId}>
            What would you like to know?
          </label>
          <input
            id={inputId}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What would you like to know? (optional, shared without your name)"
            className="flex-1 min-h-[40px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 text-sm text-gray-900 dark:text-gray-100"
          />
          <button type="button" disabled={state === "saving"} onClick={() => send("NEED_MORE_DETAIL", note)} className={btn(false)}>
            Send note
          </button>
        </div>
      )}
      <p role="status" aria-live="polite" className="text-xs text-emerald-600 dark:text-emerald-300">
        {state === "saved" ? "Thanks — the organisation sees this without your name." : ""}
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
