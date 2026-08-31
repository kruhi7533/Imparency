"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ShieldAlert, HelpCircle, Users, Building2, ListChecks, Search, FileSearch, Eye } from "lucide-react";

interface Signal {
  code: string;
  label: string;
  points: number;
  detail?: string;
}

export interface RadarRow {
  lane: "NGO" | "DONOR";
  entityId: string;
  name: string;
  subtitle: string;
  href: string;
  score: number;
  band: string;
  unknownInputs: number;
  signals: Signal[];
  computedAt: string;
}

/**
 * UNKNOWN is styled as a warning, not as an absence.
 *
 * The whole point of the band is that we cannot judge the entity, and a muted
 * grey chip would read as "nothing to see" — the exact misreading the band
 * exists to prevent.
 */
const BAND_STYLE: Record<string, { chip: string; bar: string; label: string }> = {
  HIGH: {
    chip: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/40",
    bar: "bg-red-500",
    label: "High risk",
  },
  UNKNOWN: {
    chip: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/40",
    bar: "bg-amber-500",
    label: "Not assessable",
  },
  MEDIUM: {
    chip: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-900/30",
    bar: "bg-orange-400",
    label: "Medium risk",
  },
  LOW: {
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/40",
    bar: "bg-emerald-500",
    label: "Low risk",
  },
};

export interface DecisionRow {
  id: string;
  entityType: string;
  entityId: string;
  name: string;
  href: string;
  action: string;
  status: string;
  scoreAtQueue: number;
  bandAtQueue: string;
  reason: string;
  resultRef: string | null;
  error: string | null;
  queuedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

const ACTION_STYLE: Record<string, { chip: string; icon: React.ElementType; label: string }> = {
  INVESTIGATE: {
    chip: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/40",
    icon: Search,
    label: "Investigate",
  },
  EXTRACT: {
    chip: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/40",
    icon: FileSearch,
    label: "Read documents",
  },
  MONITOR: {
    chip: "bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/60 dark:text-gray-400 dark:border-gray-800",
    icon: Eye,
    label: "Monitor only",
  },
};

const STATUS_STYLE: Record<string, string> = {
  QUEUED: "text-blue-600 dark:text-blue-400",
  RUNNING: "text-blue-600 dark:text-blue-400",
  DONE: "text-emerald-600 dark:text-emerald-400",
  FAILED: "text-red-600 dark:text-red-400",
  SKIPPED: "text-gray-400 dark:text-gray-600",
};

/**
 * Ordering priority. UNKNOWN sits directly under HIGH and ABOVE medium, however
 * low its numeric score: an entity we cannot assess is not safer than one we
 * assessed and found middling — we simply do not know, and burying it under
 * scored rows would quietly convert "no evidence" into "no problem".
 */
const BAND_RANK: Record<string, number> = { HIGH: 0, UNKNOWN: 1, MEDIUM: 2, LOW: 3 };

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function RadarCard({ row, rank }: { row: RadarRow; rank: number }) {
  const style = BAND_STYLE[row.band] ?? BAND_STYLE.LOW;

  return (
    <Link
      href={row.href}
      className="group block bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-4">
        <div className="w-8 shrink-0 pt-0.5 text-right text-sm font-black tabular-nums text-gray-300 dark:text-gray-700">
          {rank}
        </div>

        <div className="w-14 shrink-0">
          <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-white leading-none">
            {row.score}
          </div>
          <div className="mt-1.5 h-1 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${row.score}%` }} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-gray-900 dark:text-white truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
              {row.name}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 border rounded-full ${style.chip}`}>
              {style.label}
            </span>
            {row.unknownInputs > 0 && row.band !== "UNKNOWN" && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 border rounded-full bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/40"
                title="Scored high on what is known, but some evidence is still missing."
              >
                evidence incomplete
              </span>
            )}
          </div>

          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-500 capitalize">{row.subtitle}</div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {row.signals.slice(0, 3).map((s) => (
              <span
                key={s.code}
                title={s.detail}
                className="text-[11px] px-2 py-0.5 rounded-md bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border border-gray-100 dark:border-gray-800"
              >
                {s.label}
                <span className="ml-1 font-bold tabular-nums text-gray-400 dark:text-gray-600">+{s.points}</span>
              </span>
            ))}
            {row.signals.length > 3 && (
              <span className="text-[11px] px-1.5 py-0.5 text-gray-400 dark:text-gray-600">
                +{row.signals.length - 3} more
              </span>
            )}
            {row.signals.length === 0 && (
              <span className="text-[11px] text-gray-400 dark:text-gray-600">No risk signals recorded.</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function DecisionCard({ row }: { row: DecisionRow }) {
  const action = ACTION_STYLE[row.action] ?? ACTION_STYLE.MONITOR;
  const Icon = action.icon;
  const duration = formatDuration(row.durationMs);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 border rounded-full ${action.chip}`}>
          <Icon className="w-3 h-3" />
          {action.label}
        </span>
        <Link
          href={row.href}
          className="font-bold text-gray-900 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 truncate"
        >
          {row.name}
        </Link>
        <span className="text-[11px] text-gray-400 dark:text-gray-600 tabular-nums">
          scored {row.scoreAtQueue} · {row.bandAtQueue.toLowerCase()} at the time
        </span>
        <span className={`ml-auto text-[11px] font-bold ${STATUS_STYLE[row.status] ?? ""}`}>
          {row.status.toLowerCase()}
          {duration && <span className="ml-1 font-normal text-gray-400 dark:text-gray-600">({duration})</span>}
        </span>
      </div>

      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{row.reason}</p>

      {row.resultRef && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
          Result: <span className="font-mono">{row.resultRef}</span>
        </p>
      )}
      {row.error && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400 break-words">{row.error}</p>
      )}

      <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-600">
        Queued {relativeTime(row.queuedAt)}
        {row.finishedAt && ` · finished ${relativeTime(row.finishedAt)}`}
      </p>
    </div>
  );
}

export default function RiskRadarClient({
  rows,
  decisions,
  lastComputedAt,
}: {
  rows: RadarRow[];
  decisions: DecisionRow[];
  lastComputedAt: string | null;
}) {
  const [view, setView] = useState<"NGO" | "DONOR" | "DECISIONS">("NGO");
  const lane = view === "DECISIONS" ? "NGO" : view;

  const laneRows = useMemo(
    () =>
      rows
        .filter((r) => r.lane === lane)
        .sort((a, b) => (BAND_RANK[a.band] ?? 9) - (BAND_RANK[b.band] ?? 9) || b.score - a.score),
    [rows, lane]
  );

  const counts = useMemo(
    () => ({
      NGO: rows.filter((r) => r.lane === "NGO").length,
      DONOR: rows.filter((r) => r.lane === "DONOR").length,
      DECISIONS: decisions.length,
    }),
    [rows, decisions]
  );

  /**
   * Decisions that cost something are shown first, then everything else in time
   * order. A log where nine "monitor only" rows bury the one investigation that
   * actually ran is a log nobody reads.
   */
  const orderedDecisions = useMemo(
    () =>
      [...decisions].sort((a, b) => {
        const spend = (d: DecisionRow) => (d.action === "MONITOR" ? 1 : 0);
        return spend(a) - spend(b) || b.queuedAt.localeCompare(a.queuedAt);
      }),
    [decisions]
  );

  const pending = decisions.filter((d) => d.status === "QUEUED" || d.status === "RUNNING").length;
  const failed = decisions.filter((d) => d.status === "FAILED").length;

  const needsAttention = laneRows.filter((r) => r.band === "HIGH" || r.band === "UNKNOWN").length;

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Risk Radar</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
            One standing score per entity, worst first. Organisations and donors are ranked separately —
            they carry different kinds of risk and lead to different actions.
          </p>
        </div>
        {lastComputedAt && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide font-bold text-gray-400 dark:text-gray-600">
              Scores as of
            </div>
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {relativeTime(lastComputedAt)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(["NGO", "DONOR", "DECISIONS"] as const).map((option) => {
          const active = view === option;
          const Icon = option === "NGO" ? Building2 : option === "DONOR" ? Users : ListChecks;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold border transition-colors ${
                active
                  ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-800"
              }`}
            >
              <Icon className="w-4 h-4" />
              {option === "NGO" ? "Organisations" : option === "DONOR" ? "Donors" : "Decisions"}
              <span className={`tabular-nums ${active ? "opacity-70" : "text-gray-400 dark:text-gray-600"}`}>
                {counts[option]}
              </span>
            </button>
          );
        })}
      </div>

      {view === "DECISIONS" && (
        <>
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-500">
            What the Radar decided to do about each score, and what came of it. High risk goes to the fraud
            investigator; entities we cannot assess get their documents read first, because an investigation has
            nothing to read. Everything else is an explicit decision to spend nothing.
            {pending > 0 && ` ${pending} still queued.`}
            {failed > 0 && ` ${failed} failed.`}
          </p>

          <div className="mt-4 space-y-2">
            {orderedDecisions.map((row) => (
              <DecisionCard key={row.id} row={row} />
            ))}
          </div>

          {orderedDecisions.length === 0 && (
            <div className="mt-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-8 text-center">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Nothing routed yet</p>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Routing runs after scoring, at
                <code className="mx-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">
                  /api/cron/risk-dispatch
                </code>
                . It decides what to do about every score, then spends a bounded budget doing it.
              </p>
            </div>
          )}
        </>
      )}

      {view !== "DECISIONS" && laneRows.length > 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
          {needsAttention > 0 ? (
            <>
              <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
              {needsAttention} of {laneRows.length} need attention — high risk, or not assessable on the evidence held.
            </>
          ) : (
            <>
              <HelpCircle className="w-3.5 h-3.5" />
              Nothing high risk in this lane. Scores are a ranking, not a verdict.
            </>
          )}
        </p>
      )}

      {view !== "DECISIONS" && (
        <div className="mt-4 space-y-2">
          {laneRows.map((row, index) => (
            <RadarCard key={`${row.lane}-${row.entityId}`} row={row} rank={index + 1} />
          ))}
        </div>
      )}

      {view !== "DECISIONS" && laneRows.length === 0 && (
        <div className="mt-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-8 text-center">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">No scores yet</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Scores are computed on a schedule rather than on page load. Trigger the sweep at
            <code className="mx-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs">
              /api/cron/risk-scores
            </code>
            with the cron secret, or wait for the next scheduled run.
          </p>
        </div>
      )}
    </main>
  );
}
