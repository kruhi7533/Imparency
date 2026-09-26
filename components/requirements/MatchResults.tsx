"use client";

import { useState } from "react";
import type { MatchDTO, MatchRunDTO } from "@/lib/requirements/dto";

const RESULT_UI: Record<string, { icon: string; tone: string; label: string }> = {
  MATCH: { icon: "✓", tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25", label: "Match" },
  PARTIAL: { icon: "⚠", tone: "text-amber-300 bg-amber-500/10 border-amber-500/25", label: "Partial" },
  MISMATCH: { icon: "✗", tone: "text-red-300 bg-red-500/10 border-red-500/25", label: "Mismatch" },
  INSUFFICIENT_DATA: { icon: "?", tone: "text-gray-300 bg-gray-800 border-gray-700", label: "Insufficient data" },
  NOT_APPLICABLE: { icon: "–", tone: "text-gray-500 bg-gray-900 border-gray-800", label: "Not applicable" },
};

function MatchCard({
  match,
  canInvite,
  inviting,
  onInvite,
}: {
  match: MatchDTO;
  canInvite: boolean;
  inviting: boolean;
  onInvite?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = match.dimensions.filter((d) => d.result !== "NOT_APPLICABLE");

  return (
    <div className="border border-gray-800 rounded-2xl bg-gray-900/40 p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-gray-500">#{match.rank}</p>
          <h4 className="text-base font-bold text-white">{match.ngoName}</h4>
          <p className="text-xs text-gray-400">{match.projectTitle}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-black text-emerald-300 leading-none">{match.score === null ? "—" : `${match.score}%`}</p>
          <p className="text-[10px] text-gray-500 mt-1">
            {match.score === null ? "not enough data to score" : `based on ${match.coverage}% of applicable criteria`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {shown.map((d) => {
          const ui = RESULT_UI[d.result] ?? RESULT_UI.INSUFFICIENT_DATA;
          return (
            <span key={d.dimension} title={`${ui.label}: ${d.explanation}`} className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${ui.tone}`}>
              {ui.icon} {d.dimension}
            </span>
          );
        })}
      </div>

      <p className="text-xs text-gray-300">{match.explanation}</p>

      {match.gaps.length > 0 && (
        <div className="text-xs bg-gray-950/50 border border-gray-800 rounded-xl p-3">
          <p className="text-gray-400">
            <span className="font-bold text-gray-200">Main gap:</span> {match.gaps[0].description}
          </p>
          <p className="text-gray-400 mt-1">
            <span className="font-bold text-gray-200">Recommendation:</span> {match.gaps[0].recommendation}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-semibold text-emerald-400 hover:underline">
          {open ? "Hide comparison" : "Why this score?"}
        </button>
        {match.invitedAt ? (
          <span className="text-xs font-bold text-emerald-300">✓ Brief shared {new Date(match.invitedAt).toLocaleDateString("en-IN")}</span>
        ) : canInvite && onInvite ? (
          <button
            type="button"
            disabled={inviting}
            onClick={() => onInvite(match.id)}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-xs font-bold transition disabled:opacity-50"
          >
            {inviting ? "Sharing…" : "Invite to respond"}
          </button>
        ) : null}
      </div>

      {open && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-gray-500 uppercase text-[10px]">
                <tr>
                  <th className="py-1.5 pr-3">Dimension</th>
                  <th className="py-1.5 pr-3">Requirement</th>
                  <th className="py-1.5 pr-3">Project</th>
                  <th className="py-1.5 pr-3">Result</th>
                  <th className="py-1.5 pr-3">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {match.dimensions.map((d) => {
                  const ui = RESULT_UI[d.result] ?? RESULT_UI.INSUFFICIENT_DATA;
                  return (
                    <tr key={d.dimension} className="align-top">
                      <td className="py-2 pr-3 font-semibold text-gray-200">{d.dimension}</td>
                      <td className="py-2 pr-3 text-gray-400">{d.requirementValue ?? "—"}</td>
                      <td className="py-2 pr-3 text-gray-400">{d.projectValue ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${ui.tone}`}>{ui.label}</span>
                        <p className="text-gray-500 mt-1">{d.explanation}</p>
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{d.weight > 0 ? `${d.weight}%` : "not scored"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {match.hardEligibility.length > 0 && (
            <div className="text-xs">
              <p className="font-bold text-gray-300 mb-1">Hard eligibility</p>
              {match.hardEligibility.map((r) => (
                <p key={r.rule} className={r.passed ? "text-emerald-300" : "text-red-300"}>
                  {r.passed ? "✓" : "✗"} {r.rule} — {r.explanation}
                </p>
              ))}
            </div>
          )}
          {match.gaps.length > 1 && (
            <div className="text-xs space-y-1">
              <p className="font-bold text-gray-300">All gaps</p>
              {match.gaps.map((g, i) => (
                <p key={i} className="text-gray-400">
                  <span className="font-semibold text-gray-300">[{g.severity}] {g.dimension}:</span> {g.description} →{" "}
                  <span className="text-gray-300">{g.recommendation}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Ranked shortlist with per-dimension explanations; hard-excluded candidates listed separately. */
export function MatchResults({
  run,
  canInvite = false,
  onInvite,
  invitingId = null,
}: {
  run: MatchRunDTO;
  canInvite?: boolean;
  onInvite?: (matchId: string) => void;
  invitingId?: string | null;
}) {
  const [showExcluded, setShowExcluded] = useState(false);
  const eligible = run.matches.filter((m) => m.eligible);
  const excluded = run.matches.filter((m) => !m.eligible);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>
          Run {new Date(run.createdAt).toLocaleString("en-IN")} · {run.candidateCount} projects evaluated · {run.eligibleCount} eligible ·{" "}
          {excluded.length} excluded by hard rules
        </span>
        <span
          className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${
            run.reviewStatus === "APPROVED"
              ? "text-emerald-300 border-emerald-500/30"
              : run.reviewStatus === "REJECTED"
              ? "text-red-300 border-red-500/30"
              : "text-gray-300 border-gray-700"
          }`}
        >
          Admin review: {run.reviewStatus.toLowerCase()}
        </span>
      </div>
      {run.reviewStatus === "REJECTED" && run.reviewNote && (
        <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2">
          Analysis rejected by admin: {run.reviewNote}
        </p>
      )}
      <p className="text-[11px] text-gray-500">
        Scores use only criteria with data on both sides (sector 25%, geography 20%, budget 20%, outcome KPIs 15%, duration 10%,
        track record 10%). Criteria without data are marked “insufficient data” and never scored. The ranking is advisory — the
        final choice is yours.
      </p>

      {eligible.length === 0 ? (
        <p className="text-sm text-gray-400">No eligible NGO projects matched this requirement.</p>
      ) : (
        eligible.map((m) => (
          <MatchCard key={m.id} match={m} canInvite={canInvite && run.reviewStatus !== "REJECTED"} inviting={invitingId === m.id} onInvite={onInvite} />
        ))
      )}

      {excluded.length > 0 && (
        <div className="border border-gray-800 rounded-2xl p-4">
          <button type="button" onClick={() => setShowExcluded((s) => !s)} className="text-xs font-semibold text-gray-300">
            {showExcluded ? "▾" : "▸"} {excluded.length} project(s) excluded by hard eligibility rules
          </button>
          {showExcluded && (
            <ul className="mt-3 space-y-2 text-xs">
              {excluded.map((m) => (
                <li key={m.id} className="text-gray-400">
                  <span className="font-semibold text-gray-200">{m.ngoName}</span> — {m.projectTitle}:{" "}
                  {m.hardEligibility.filter((r) => !r.passed).map((r) => r.explanation).join(" ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
