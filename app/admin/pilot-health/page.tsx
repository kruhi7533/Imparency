import Link from "next/link";
import { judgeSignals, loadPilotSignals, type Level } from "@/lib/pilot-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pilot health: one screen answering "is the pilot OK right now?" (roadmap
 * row 15). Each line links to the screen where you act on it. The verdict rule
 * is lib/pilot-health.ts judgeSignals; the procedure is docs/RUNBOOK.md.
 */
const TONE: Record<Level, { dot: string; ring: string; text: string; label: string }> = {
  green: { dot: "bg-emerald-500", ring: "ring-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:ring-emerald-900/40", text: "text-emerald-800 dark:text-emerald-300", label: "Healthy" },
  amber: { dot: "bg-amber-500", ring: "ring-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:ring-amber-900/40", text: "text-amber-800 dark:text-amber-300", label: "Needs attention" },
  red: { dot: "bg-red-500", ring: "ring-red-200 bg-red-50 dark:bg-red-950/30 dark:ring-red-900/40", text: "text-red-800 dark:text-red-300", label: "Act now" },
};

export default async function PilotHealthPage() {
  const { level, signals } = judgeSignals(await loadPilotSignals());
  const tone = TONE[level];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Pilot health</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            Is the pilot OK right now? Every line links to where you act on it. What to do when something is red is in
            the runbook (docs/RUNBOOK.md).
          </p>
        </div>

        <div role="status" className={`flex items-center gap-3 rounded-2xl px-5 py-4 ring-1 ${tone.ring}`}>
          <span className={`h-3 w-3 rounded-full ${tone.dot}`} aria-hidden="true" />
          <p className={`text-base font-extrabold ${tone.text}`}>{tone.label}</p>
        </div>

        <ul className="space-y-2">
          {signals.map((s) => {
            const t = TONE[s.level];
            return (
              <li key={s.key}>
                <Link
                  href={s.href}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                >
                  <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${t.dot}`} aria-hidden="true" />
                  <span className="sr-only">{t.label}: </span>
                  <span className="text-sm text-gray-800 dark:text-gray-200">{s.text}</span>
                  <span className="ml-auto text-xs text-gray-400" aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Outside-in check for an uptime monitor: <code className="font-mono">GET /api/health</code>. Error alerts go to{" "}
          <code className="font-mono">ERROR_WEBHOOK_URL</code> when it is set.
        </p>
      </div>
    </div>
  );
}
