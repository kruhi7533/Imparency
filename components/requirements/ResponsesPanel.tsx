"use client";

import { useState } from "react";
import type { ResponseItem } from "@/lib/requirements/queries";
import type { ResponseRevisionItem } from "@/lib/requirements/dto";
import { CHANGE_NOTE_MIN, CHANGE_NOTE_MAX, RESPONSE_STATUS_LABELS } from "@/lib/requirements/response-status";
import { diffProposals, type ProposalSnapshot } from "@/lib/requirements/proposal-diff";

const STATUS_TONE: Record<string, string> = {
  INTERESTED: "text-gray-700 border-gray-300",
  PROPOSAL_SUBMITTED: "text-blue-700 border-blue-200",
  CHANGES_REQUESTED: "text-amber-700 border-amber-200",
  UNDER_REVIEW: "text-amber-700 border-amber-200",
  SHORTLISTED: "text-teal-700 border-teal-200",
  REJECTED: "text-red-700 border-red-200",
  SELECTED: "text-emerald-700 border-emerald-200",
};

/** Statuses a donor can act on (request changes / approve). */
const DECIDABLE = new Set(["PROPOSAL_SUBMITTED", "UNDER_REVIEW"]);

const inr = (n: number | null) => (n === null ? "—" : `₹${n.toLocaleString("en-IN")}`);

type ProposalVersion = Pick<
  ResponseRevisionItem,
  "proposedBudget" | "proposedDurationMonths" | "implementationPlan" | "expectedOutcomes" | "complianceNotes" | "milestones"
>;

function milestoneList(m: unknown): any[] {
  return Array.isArray(m) ? m : [];
}

/** Plain-language list of what changed between two versions of a proposal. */
export function describeChanges(older: ProposalVersion, newer: ProposalVersion): string[] {
  const out: string[] = [];
  if (older.proposedBudget !== newer.proposedBudget) out.push(`Budget ${inr(older.proposedBudget)} → ${inr(newer.proposedBudget)}`);
  if (older.proposedDurationMonths !== newer.proposedDurationMonths) {
    out.push(`Duration ${older.proposedDurationMonths ?? "—"} → ${newer.proposedDurationMonths ?? "—"} months`);
  }
  const om = milestoneList(older.milestones);
  const nm = milestoneList(newer.milestones);
  if (JSON.stringify(om) !== JSON.stringify(nm)) out.push(`Milestones updated (${om.length} → ${nm.length})`);
  if ((older.implementationPlan ?? "") !== (newer.implementationPlan ?? "")) out.push("Implementation plan revised");
  if ((older.expectedOutcomes ?? "") !== (newer.expectedOutcomes ?? "")) out.push("Expected outcomes revised");
  if ((older.complianceNotes ?? "") !== (newer.complianceNotes ?? "")) out.push("Compliance information revised");
  return out;
}

function Milestones({ items }: { items: unknown }) {
  const list = milestoneList(items);
  if (list.length === 0) return <p className="text-gray-500">No milestones.</p>;
  return (
    <ul className="space-y-1">
      {list.map((m: any, i: number) => (
        <li key={i}>
          {i + 1}. {m.title} {m.amount ? `— ${inr(m.amount)}` : ""} {m.durationMonths ? `(${m.durationMonths} mo)` : ""}
        </li>
      ))}
    </ul>
  );
}

function PreviousVersions({ revisions }: { revisions: ResponseRevisionItem[] }) {
  if (revisions.length === 0) return null;
  return (
    <details className="text-xs text-gray-700 border border-gray-200 rounded-xl px-3 py-2">
      <summary className="cursor-pointer font-semibold text-gray-800">Previous versions ({revisions.length})</summary>
      <ol className="mt-3 space-y-3">
        {revisions.map((v) => (
          <li key={v.version} className="border-l-2 border-gray-300 pl-3 space-y-1.5">
            <p className="font-bold text-gray-800">
              V{v.version} <span className="font-normal text-gray-500">· submitted {new Date(v.submittedAt).toLocaleDateString("en-IN")}</span>
            </p>
            {v.supersededBecause && (
              <p className="text-amber-700">
                <span className="font-semibold">Your change request:</span> <span className="whitespace-pre-wrap">{v.supersededBecause}</span>
              </p>
            )}
            <p>
              Budget {inr(v.proposedBudget)} · {v.proposedDurationMonths ? `${v.proposedDurationMonths} months` : "duration not given"}
            </p>
            {v.implementationPlan && <p className="whitespace-pre-wrap text-gray-600">{v.implementationPlan}</p>}
            <Milestones items={v.milestones} />
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * DON-008 — explicit side-by-side comparison of any two versions of one
 * proposal (default: the previous version vs the current one), with word-level
 * highlights: removed text struck through in red, added text in green.
 */
function CompareVersions({ r }: { r: ResponseItem }) {
  const versions: ProposalSnapshot[] = [
    ...[...r.revisions].sort((a, b) => a.version - b.version),
    {
      version: r.version,
      proposedBudget: r.proposedBudget,
      proposedDurationMonths: r.proposedDurationMonths,
      implementationPlan: r.implementationPlan,
      expectedOutcomes: r.expectedOutcomes,
      complianceNotes: r.complianceNotes,
      milestones: r.milestones,
    },
  ];
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(versions[versions.length - 2]?.version ?? 1);
  const [to, setTo] = useState(r.version);
  if (versions.length < 2) return null;
  const a = versions.find((v) => v.version === from)!;
  const b = versions.find((v) => v.version === to)!;
  const rows = a && b ? diffProposals(a, b) : [];
  const changedCount = rows.filter((x) => x.changed).length;
  const select = "bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-900";

  return (
    <div className="border border-blue-200 rounded-xl">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left px-3 py-2 text-xs font-bold text-blue-700">
        {open ? "▾" : "▸"} Compare versions side by side
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
            <label htmlFor={`cmp-from-${r.id}`}>Compare</label>
            <select id={`cmp-from-${r.id}`} value={from} onChange={(e) => setFrom(Number(e.target.value))} className={select}>
              {versions.map((v) => <option key={v.version} value={v.version}>V{v.version}</option>)}
            </select>
            <label htmlFor={`cmp-to-${r.id}`}>with</label>
            <select id={`cmp-to-${r.id}`} value={to} onChange={(e) => setTo(Number(e.target.value))} className={select}>
              {versions.map((v) => <option key={v.version} value={v.version}>V{v.version}{v.version === r.version ? " (current)" : ""}</option>)}
            </select>
            <span className="text-gray-500">{changedCount} of {rows.length} fields changed</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left align-top">
              <thead className="text-gray-500 uppercase text-[10px]">
                <tr>
                  <th className="py-1 pr-2 w-32">Field</th>
                  <th className="py-1 pr-2">V{from}</th>
                  <th className="py-1">V{to}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={`border-t border-gray-200 ${row.changed ? "bg-blue-50" : ""}`}>
                    <td className="py-2 pr-2 font-semibold text-gray-700">
                      {row.label}
                      {row.changed && <span className="block text-[10px] text-blue-700">changed</span>}
                    </td>
                    <td className="py-2 pr-2 text-gray-600 whitespace-pre-wrap">
                      {row.tokens
                        ? row.tokens.filter((t) => t.op !== "added").map((t, i) => (
                            <span key={i} className={t.op === "removed" ? "bg-red-50 text-red-700 line-through" : ""}>{t.text}</span>
                          ))
                        : row.before}
                      {!row.before && "—"}
                    </td>
                    <td className="py-2 text-gray-800 whitespace-pre-wrap">
                      {row.tokens
                        ? row.tokens.filter((t) => t.op !== "removed").map((t, i) => (
                            <span key={i} className={t.op === "added" ? "bg-emerald-50 text-emerald-700" : ""}>{t.text}</span>
                          ))
                        : row.after}
                      {!row.after && "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ResponseCard({
  r,
  canDecide,
  onSelect,
  onRequestChanges,
  busyId,
}: {
  r: ResponseItem;
  canDecide: boolean;
  onSelect?: (responseId: string) => void;
  onRequestChanges?: (responseId: string, note: string) => Promise<boolean>;
  busyId: string | null;
}) {
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState("");
  const decidable = canDecide && DECIDABLE.has(r.status);
  const latestRevision = r.revisions[0];
  const changes = latestRevision ? describeChanges(latestRevision, r) : [];
  const noteOk = note.trim().length >= CHANGE_NOTE_MIN;

  async function sendChangeRequest() {
    if (!onRequestChanges || !noteOk) return;
    const ok = await onRequestChanges(r.id, note.trim());
    if (ok) {
      setRequesting(false);
      setNote("");
    }
  }

  return (
    <div className="border border-gray-200/80 rounded-2xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-bold text-gray-900">{r.ngo.orgName}</h4>
          <p className="text-xs text-gray-600">{r.project.title}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {r.status !== "INTERESTED" && (
            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">V{r.version}</span>
          )}
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS_TONE[r.status] ?? STATUS_TONE.INTERESTED}`}>
            {RESPONSE_STATUS_LABELS[r.status as keyof typeof RESPONSE_STATUS_LABELS] ?? r.status}
          </span>
        </div>
      </div>

      {r.status === "CHANGES_REQUESTED" && (
        <div className="text-xs rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
          <p className="font-bold text-amber-700">Revision {r.revisionRounds} — waiting on the organisation</p>
          {r.changeRequestNote && <p className="text-amber-700 whitespace-pre-wrap">{r.changeRequestNote}</p>}
        </div>
      )}
      {r.status !== "CHANGES_REQUESTED" && latestRevision && (
        <div className="text-xs rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 space-y-1">
          <p className="font-bold text-blue-700">
            Revised proposal V{r.version}
            {latestRevision.supersededBecause ? " — in reply to your change request" : ""}
          </p>
          {changes.length > 0 ? (
            <ul className="list-disc list-inside text-blue-700">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="text-blue-700">No field changed since V{latestRevision.version}.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <p className="text-gray-500">Proposed budget</p>
          <p className="font-bold text-gray-900">{inr(r.proposedBudget)}</p>
        </div>
        <div>
          <p className="text-gray-500">Duration</p>
          <p className="font-bold text-gray-900">{r.proposedDurationMonths ? `${r.proposedDurationMonths} months` : "—"}</p>
        </div>
        <div>
          <p className="text-gray-500">Health score</p>
          <p className="font-bold text-gray-900">{r.ngo.healthScore === null ? "Pending" : `${Math.round(r.ngo.healthScore)}/100`}</p>
        </div>
        <div>
          <p className="text-gray-500">Submitted</p>
          <p className="font-bold text-gray-900">{new Date(r.submittedAt).toLocaleDateString("en-IN")}</p>
        </div>
      </div>
      {r.implementationPlan && (
        <details className="text-xs text-gray-700">
          <summary className="cursor-pointer font-semibold text-gray-800">Implementation plan</summary>
          <p className="mt-2 whitespace-pre-wrap">{r.implementationPlan}</p>
        </details>
      )}
      {r.expectedOutcomes && (
        <details className="text-xs text-gray-700">
          <summary className="cursor-pointer font-semibold text-gray-800">Expected outcomes</summary>
          <p className="mt-2 whitespace-pre-wrap">{r.expectedOutcomes}</p>
        </details>
      )}
      {milestoneList(r.milestones).length > 0 && (
        <details className="text-xs text-gray-700" open={decidable}>
          <summary className="cursor-pointer font-semibold text-gray-800">Proposed milestones ({milestoneList(r.milestones).length})</summary>
          <div className="mt-2">
            <Milestones items={r.milestones} />
          </div>
        </details>
      )}
      {r.complianceNotes && <p className="text-xs text-gray-600">Compliance: {r.complianceNotes}</p>}

      <CompareVersions r={r} />
      <PreviousVersions revisions={r.revisions} />

      {canDecide && r.status === "INTERESTED" && (
        <p className="text-xs text-gray-500">Interest only — waiting for the organisation to submit a full proposal (budget and plan).</p>
      )}

      {decidable && !requesting && (
        <div className="flex flex-wrap justify-end gap-2">
          {onRequestChanges && (
            <button
              type="button"
              disabled={!!busyId}
              onClick={() => setRequesting(true)}
              className="px-4 py-2 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 text-xs font-bold transition disabled:opacity-50"
            >
              Request changes
            </button>
          )}
          {onSelect && (
            <button
              type="button"
              disabled={!!busyId}
              onClick={() => onSelect(r.id)}
              className="px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-xs font-bold transition disabled:opacity-50"
            >
              {busyId === `select:${r.id}` ? "Approving…" : `Approve proposal V${r.version}`}
            </button>
          )}
        </div>
      )}

      {decidable && requesting && (
        <div className="space-y-2">
          <label htmlFor={`change-note-${r.id}`} className="block text-xs font-semibold text-gray-700">
            What should the organisation change? They see this note, word for word.
          </label>
          <textarea
            id={`change-note-${r.id}`}
            value={note}
            maxLength={CHANGE_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="e.g. Reduce the budget to ₹6,00,000 and split milestone 2 into quarterly deliverables with attendance targets."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-gray-500">
              {noteOk ? "The proposal goes back to the organisation; you can approve their revised version." : `At least ${CHANGE_NOTE_MIN} characters.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => {
                  setRequesting(false);
                  setNote("");
                }}
                className="px-4 py-2 rounded-lg text-gray-600 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!busyId || !noteOk}
                onClick={sendChangeRequest}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {busyId === `changes:${r.id}` ? "Sending…" : "Send change request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * NGO proposals on a requirement. While the requirement is in NGO_RESPONSE the
 * owner (or an admin) can send a proposal back with a note, or approve it —
 * approval is terminal and declines every other proposal.
 */
export function ResponsesPanel({
  responses,
  canSelect,
  onSelect,
  onRequestChanges,
  busyId = null,
}: {
  responses: ResponseItem[];
  canSelect: boolean;
  onSelect?: (responseId: string) => void;
  onRequestChanges?: (responseId: string, note: string) => Promise<boolean>;
  busyId?: string | null;
}) {
  if (responses.length === 0) {
    return <p className="text-sm text-gray-600">No NGO has responded yet. Invited NGOs see a sanitized brief, never your document.</p>;
  }
  return (
    <div className="space-y-3">
      {responses.map((r) => (
        <ResponseCard key={r.id} r={r} canDecide={canSelect} onSelect={onSelect} onRequestChanges={onRequestChanges} busyId={busyId} />
      ))}
    </div>
  );
}
