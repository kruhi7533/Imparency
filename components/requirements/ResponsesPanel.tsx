"use client";

import type { ResponseItem } from "@/lib/requirements/queries";

const STATUS_TONE: Record<string, string> = {
  INTERESTED: "text-gray-300 border-gray-700",
  PROPOSAL_SUBMITTED: "text-blue-300 border-blue-500/30",
  UNDER_REVIEW: "text-amber-300 border-amber-500/30",
  SHORTLISTED: "text-teal-300 border-teal-500/30",
  REJECTED: "text-red-300 border-red-500/30",
  SELECTED: "text-emerald-300 border-emerald-500/40",
};

const inr = (n: number | null) => (n === null ? "—" : `₹${n.toLocaleString("en-IN")}`);

/** NGO responses to the opportunity brief; the select action appears only when allowed. */
export function ResponsesPanel({
  responses,
  canSelect,
  onSelect,
  selectingId = null,
}: {
  responses: ResponseItem[];
  canSelect: boolean;
  onSelect?: (responseId: string) => void;
  selectingId?: string | null;
}) {
  if (responses.length === 0) {
    return <p className="text-sm text-gray-400">No NGO has responded yet. Invited NGOs see a sanitized brief, never your document.</p>;
  }
  return (
    <div className="space-y-3">
      {responses.map((r) => (
        <div key={r.id} className="border border-gray-800 rounded-2xl bg-gray-900/40 p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-white">{r.ngo.orgName}</h4>
              <p className="text-xs text-gray-400">{r.project.title}</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_TONE[r.status] ?? STATUS_TONE.INTERESTED}`}>
              {r.status.replace(/_/g, " ").toLowerCase()}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-gray-500">Proposed budget</p>
              <p className="font-bold text-gray-100">{inr(r.proposedBudget)}</p>
            </div>
            <div>
              <p className="text-gray-500">Duration</p>
              <p className="font-bold text-gray-100">{r.proposedDurationMonths ? `${r.proposedDurationMonths} months` : "—"}</p>
            </div>
            <div>
              <p className="text-gray-500">Health score</p>
              <p className="font-bold text-gray-100">{r.ngo.healthScore === null ? "Pending" : `${Math.round(r.ngo.healthScore)}/100`}</p>
            </div>
            <div>
              <p className="text-gray-500">Submitted</p>
              <p className="font-bold text-gray-100">{new Date(r.submittedAt).toLocaleDateString("en-IN")}</p>
            </div>
          </div>
          {r.implementationPlan && (
            <details className="text-xs text-gray-300">
              <summary className="cursor-pointer font-semibold text-gray-200">Implementation plan</summary>
              <p className="mt-2 whitespace-pre-wrap">{r.implementationPlan}</p>
            </details>
          )}
          {r.expectedOutcomes && (
            <details className="text-xs text-gray-300">
              <summary className="cursor-pointer font-semibold text-gray-200">Expected outcomes</summary>
              <p className="mt-2 whitespace-pre-wrap">{r.expectedOutcomes}</p>
            </details>
          )}
          {Array.isArray(r.milestones) && r.milestones.length > 0 && (
            <details className="text-xs text-gray-300">
              <summary className="cursor-pointer font-semibold text-gray-200">Proposed milestones ({r.milestones.length})</summary>
              <ul className="mt-2 space-y-1">
                {r.milestones.map((m: any, i: number) => (
                  <li key={i}>
                    {i + 1}. {m.title} {m.amount ? `— ${inr(m.amount)}` : ""} {m.durationMonths ? `(${m.durationMonths} mo)` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {r.complianceNotes && <p className="text-xs text-gray-400">Compliance: {r.complianceNotes}</p>}
          {canSelect && onSelect && r.status !== "REJECTED" && r.status !== "SELECTED" && (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!!selectingId}
                onClick={() => onSelect(r.id)}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-xs font-bold transition disabled:opacity-50"
              >
                {selectingId === r.id ? "Selecting…" : "Select this NGO"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
