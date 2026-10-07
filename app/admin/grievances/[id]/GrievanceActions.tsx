"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/**
 * Moving a complaint along.
 *
 * Mirrors ProposalActions, with one deliberate difference: there is no button
 * that ends a complaint in a single click. Dismissing requires the grievance
 * to already be under investigation, so the UI cannot offer it from the queue
 * either — the server would refuse, and offering an action that always fails
 * is worse than not offering it.
 *
 * Both closing actions demand a written reason and the button stays disabled
 * until there is one, so the refusal is visible before the request rather than
 * as an error afterwards.
 */
export default function GrievanceActions({
  grievanceId,
  status,
}: {
  grievanceId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>("");
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState<null | "RESOLVE" | "DISMISS">(null);

  async function act(action: "TRIAGE" | "START_INVESTIGATION" | "RESOLVE" | "DISMISS") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/grievances/${grievanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "TRIAGE" ? { severity } : {}),
          ...(action === "RESOLVE" || action === "DISMISS" ? { note: note.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update this grievance");
      setClosing(null);
      setNote("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (status === "RESOLVED" || status === "DISMISSED") {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        This grievance was {status.toLowerCase()} and cannot be reopened. If the problem is
        ongoing, the reporter needs to file again — a second complaint about something already
        closed is itself worth seeing.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {status === "OPEN" && (
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            How serious is this?
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Your judgement, not the reporter&apos;s — they were never asked. Safeguarding and
            misuse of funds normally sit at the top, but decide on what this one says.
          </p>
          <div className="flex gap-2 flex-wrap">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                  severity === s
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!!busy || !severity}
            onClick={() => act("TRIAGE")}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "TRIAGE" ? "Recording…" : "Triage"}
          </button>
        </div>
      )}

      {status === "TRIAGED" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Triaged. It cannot be resolved or dismissed until someone has actually looked into it.
          </p>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act("START_INVESTIGATION")}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === "START_INVESTIGATION" ? "Starting…" : "Start investigating"}
          </button>
        </div>
      )}

      {status === "INVESTIGATING" && !closing && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => setClosing("RESOLVE")}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Resolve
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => setClosing("DISMISS")}
            className="rounded-lg border border-red-200 dark:border-red-900/40 px-4 py-2 text-sm font-bold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Dismiss
          </button>
        </div>
      )}

      {status === "INVESTIGATING" && closing && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder={
              closing === "DISMISS"
                ? "Why is this being dismissed? Write it as if the reporter will read it — they are entitled to a reason."
                : "What was done about it? This is the record of the outcome."
            }
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-[11px] text-gray-400 dark:text-gray-600">
            Kept on the grievance record, not copied into the audit log.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!!busy || !note.trim()}
              onClick={() => act(closing)}
              className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
                closing === "DISMISS" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {busy ? "Saving…" : closing === "DISMISS" ? "Confirm dismissal" : "Confirm resolution"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                setClosing(null);
                setNote("");
              }}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
