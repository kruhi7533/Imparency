"use client";

import React, { useState } from "react";

/**
 * One fraud investigation, expandable into the exact steps it took.
 *
 * The trace exists so a finding can be checked rather than trusted: which tools
 * ran, what they returned, and where the run stopped. An admin who cannot see
 * that has no basis to act on a HIGH finding, and no way to tell us the
 * investigator was wrong.
 */

export interface InvestigationTraceEntry {
  seq: number;
  kind: "MODEL_CALL" | "TOOL_CALL" | "TOOL_RESULT" | "ERROR";
  toolName?: string;
  args?: any;
  result?: any;
  ok?: boolean;
  tokensIn?: number;
  tokensOut?: number;
}

export interface Investigation {
  id: string;
  ngoId: string;
  ngo: { orgName: string };
  status: string;
  triggeredBy: string;
  stepsUsed: number;
  tokensIn: number;
  tokensOut: number;
  costPaise: number;
  riskLevel: string | null;
  summary: string | null;
  riskReviewId: string | null;
  trace: InvestigationTraceEntry[];
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30",
  RUNNING: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30",
  FAILED: "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30",
};

const RISK_BADGE: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30",
  LOW: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30",
};

/** Paise are integers; a free-tier model genuinely costs 0 and should say so. */
function formatCost(paise: number): string {
  if (!paise) return "no cost";
  return `₹${(paise / 100).toFixed(2)}`;
}

/** "alert:<id>" | "manual:<adminId>" — show the kind, not the raw id. */
function formatTrigger(triggeredBy: string): string {
  if (triggeredBy.startsWith("manual:")) return "Started by an admin";
  if (triggeredBy.startsWith("alert:")) return "Auto-started by a HIGH alert";
  return triggeredBy;
}

function StepRow({ entry }: { entry: InvestigationTraceEntry }) {
  const [open, setOpen] = useState(false);

  if (entry.kind === "MODEL_CALL") {
    return (
      <li className="flex items-center gap-2 py-1.5 text-xs text-gray-400 dark:text-gray-500">
        <span className="font-mono text-[10px] w-6 shrink-0 text-right">{entry.seq}</span>
        <span className="italic">
          model thought
          {typeof entry.tokensIn === "number" ? ` · ${entry.tokensIn.toLocaleString("en-IN")} in / ${(entry.tokensOut ?? 0).toLocaleString("en-IN")} out` : ""}
        </span>
      </li>
    );
  }

  const isResult = entry.kind === "TOOL_RESULT";
  const payload = isResult ? entry.result : entry.args;
  const hasPayload = payload !== undefined && payload !== null && Object.keys(payload ?? {}).length > 0;

  return (
    <li className="py-1.5 text-xs">
      <div className="flex items-start gap-2">
        <span className="font-mono text-[10px] w-6 shrink-0 text-right text-gray-400 pt-0.5">{entry.seq}</span>
        <button
          type="button"
          onClick={() => hasPayload && setOpen(!open)}
          className={`text-left flex items-center gap-1.5 ${hasPayload ? "hover:underline underline-offset-2" : "cursor-default"}`}
        >
          <span
            className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
              entry.kind === "ERROR" || entry.ok === false
                ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                : isResult
                ? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                : "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400"
            }`}
          >
            {isResult ? "returned" : "called"}
          </span>
          <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{entry.toolName}</span>
          {hasPayload && <span className="text-gray-400">{open ? "▾" : "▸"}</span>}
        </button>
      </div>
      {open && hasPayload && (
        <pre className="mt-1 ml-8 rounded-lg bg-gray-900 text-gray-200 text-[10px] leading-relaxed px-3 py-2 overflow-x-auto max-h-64">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

export default function InvestigationTrace({ investigation }: { investigation: Investigation }) {
  const [open, setOpen] = useState(false);
  const trace = Array.isArray(investigation.trace) ? investigation.trace : [];

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/admin/ngos/${investigation.ngoId}`}
              className="text-sm font-black text-gray-900 dark:text-white hover:text-emerald-600 hover:underline"
            >
              {investigation.ngo.orgName}
            </a>
            <span
              className={`text-[10px] font-extrabold px-2 py-0.5 border rounded-full ${
                STATUS_BADGE[investigation.status] || STATUS_BADGE.RUNNING
              }`}
            >
              {investigation.status}
            </span>
            {investigation.riskLevel ? (
              <span
                className={`text-[10px] font-extrabold px-2 py-0.5 border rounded-full ${
                  RISK_BADGE[investigation.riskLevel] || RISK_BADGE.LOW
                }`}
              >
                {investigation.riskLevel}
              </span>
            ) : investigation.status === "COMPLETED" ? (
              // A completed run with no risk level filed nothing. Say that
              // plainly — a blank space reads as "not done yet".
              <span className="text-[10px] font-bold px-2 py-0.5 border border-gray-200 dark:border-gray-700 text-gray-500 rounded-full">
                nothing filed
              </span>
            ) : null}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {formatTrigger(investigation.triggeredBy)} ·{" "}
            {new Date(investigation.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </p>

          {investigation.summary && (
            <p className="text-xs text-gray-700 dark:text-gray-300 mt-2 max-w-3xl leading-relaxed">
              {investigation.summary}
            </p>
          )}

          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 font-mono">
            {investigation.stepsUsed} step{investigation.stepsUsed === 1 ? "" : "s"} ·{" "}
            {(investigation.tokensIn + investigation.tokensOut).toLocaleString("en-IN")} tokens ·{" "}
            {formatCost(investigation.costPaise)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {trace.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="text-xs font-bold py-1.5 px-3 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition"
            >
              {open ? "Hide trace" : `Show trace (${trace.length})`}
            </button>
          )}
          {investigation.riskReviewId && (
            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">Opened a risk review</span>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-[10px] uppercase tracking-wide font-extrabold text-gray-400 mb-2">
            What it actually did
          </p>
          <ul className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {trace.map((entry, i) => (
              <StepRow key={`${entry.seq}-${i}`} entry={entry} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
