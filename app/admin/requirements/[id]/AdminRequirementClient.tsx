"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MatchRunDTO, RequirementDTO } from "@/lib/requirements/dto";
import type { AuditItem, ResponseItem } from "@/lib/requirements/queries";
import { ADMIN_EDITABLE } from "@/lib/requirements/status";
import { StatusBadge } from "@/components/requirements/StatusBadge";
import { RequirementStepper } from "@/components/requirements/RequirementStepper";
import { FieldsEditor, initialDraft, draftEdits, type FieldDraft } from "@/components/requirements/FieldsEditor";
import { VersionHistory } from "@/components/requirements/VersionHistory";
import { DocumentPreview } from "@/components/requirements/DocumentPreview";
import { MatchResults } from "@/components/requirements/MatchResults";
import { ResponsesPanel } from "@/components/requirements/ResponsesPanel";
import { AuditTrail } from "@/components/requirements/AuditTrail";
import { requirementApi } from "@/components/requirements/api";
import { ExtractionErrorDetail, ExtractionFlagsPanel, ExtractionMethodBanner } from "@/components/requirements/ExtractionNotices";
import { ShortlistReview } from "@/components/requirements/ShortlistReview";

type Tab = "requirements" | "history" | "matches" | "responses" | "audit";
type Decision = "approve" | "correction" | "reject" | null;

const RERUNNABLE = ["AI_EXTRACTED", "DONOR_REVIEW", "PENDING_ADMIN_REVIEW", "NEEDS_CORRECTION", "FAILED"];
const CORRECTABLE = ["DONOR_REVIEW", "PENDING_ADMIN_REVIEW"];

export default function AdminRequirementClient({
  requirement,
  matchRun,
  responses,
  events,
}: {
  requirement: RequirementDTO;
  matchRun: MatchRunDTO | null;
  responses: ResponseItem[];
  events: AuditItem[];
}) {
  const router = useRouter();
  const { id, status } = requirement;
  const editable = (ADMIN_EDITABLE as string[]).includes(status);
  const [tab, setTab] = useState<Tab>("requirements");
  const [draft, setDraft] = useState<FieldDraft>(() => initialDraft(requirement.fields));
  const [decision, setDecision] = useState<Decision>(null);
  const [note, setNote] = useState("");
  const [runNote, setRunNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialDraft(requirement.fields));
  }, [requirement.version, requirement.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const edits = draftEdits(requirement.fields, draft);
  const dirty = Object.keys(edits).length > 0;

  async function perform(label: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
      setDecision(null);
      setNote("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const post = (path: string, body?: object) =>
    requirementApi(`/api/requirements/${id}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });

  const saveEdits = () =>
    perform("save", () => requirementApi(`/api/requirements/${id}`, { method: "PUT", body: JSON.stringify({ fields: edits }) }), "Admin corrections saved as a new version.");

  const confirmDecision = () => {
    if (decision === "approve") {
      perform(
        "approve",
        async () => {
          if (dirty) await requirementApi(`/api/requirements/${id}`, { method: "PUT", body: JSON.stringify({ fields: edits }) });
          await post("admin-approve", { note });
        },
        "Requirement validated. It can now enter matching."
      );
    } else if (decision === "correction") {
      perform("correction", () => post("request-correction", { note }), "Correction requested — the donor has been sent back to review.");
    } else if (decision === "reject") {
      perform("reject", () => post("admin-reject", { reason: note }), "Requirement rejected.");
    }
  };

  const rerun = () => {
    if (!window.confirm("Re-run AI extraction? The current fields are kept in version history and replaced by a fresh extraction, which the donor must review again.")) return;
    perform("rerun", () => post("rerun-extraction"), "Extraction re-run complete.");
  };

  const reviewRun = (action: "approve" | "reject" | "request-reanalysis") =>
    perform(
      `run:${action}`,
      () => requirementApi(`/api/gap-analysis/report/${matchRun!.id}`, { method: "PUT", body: JSON.stringify({ action, note: runNote }) }),
      action === "approve" ? "Matching analysis approved." : "Matching analysis rejected — invitations are blocked until matching is re-run."
    ).then(() => setRunNote(""));

  const confirmFlag = async (flagId: string, note: string) => {
    let ok = false;
    await perform(`flag:${flagId}`, async () => {
      await post("confirm-flag", { flagId, note });
      ok = true;
    }, "Warning confirmed.");
    return ok;
  };
  const approveShortlist = (payload: object) =>
    perform(
      "shortlist",
      () => requirementApi(`/api/requirements/${id}/shortlist`, { method: "PUT", body: JSON.stringify(payload) }),
      "Shortlist approved. The donor sees the approved candidates in your order and can invite them."
    );
  const invitedAny = !!matchRun?.matches.some((m) => m.invitedAt);
  const canReviewShortlist = status === "SHORTLISTED" && !!matchRun && !invitedAny;
  const openFlags = requirement.extractionFlags.filter((f) => f.blocking && !f.confirmedAt).length;

  const tabs: Tab[] = ["requirements", "history", ...(matchRun ? (["matches"] as Tab[]) : []), ...(responses.length ? (["responses"] as Tab[]) : []), "audit"];

  return (
    <div className="py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <Link href="/admin/requirements" className="text-xs font-bold text-emerald-500 hover:underline">
            ← CSR Requirements queue
          </Link>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight break-all text-gray-900">{requirement.fileName}</h1>
            <StatusBadge status={status} />
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">v{requirement.version}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Donor: {requirement.sponsor?.companyName || requirement.sponsor?.name} ({requirement.sponsor?.email}) · {requirement.isFormEntry ? "Entered via form" : "Uploaded"}{" "}
            {new Date(requirement.createdAt).toLocaleString("en-IN")}
            {requirement.submittedAt && ` · Submitted ${new Date(requirement.submittedAt).toLocaleString("en-IN")}`} · Avg. confidence{" "}
            {Math.round(requirement.averageConfidence * 100)}%
          </p>
          <div className="mt-4">
            <RequirementStepper status={status} />
          </div>
        </div>

        {notice && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2">{notice}</p>}
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}

        {status === "FAILED" && (
          <div className="border border-red-200 bg-red-50 rounded-2xl p-5 text-sm">
            <ExtractionErrorDetail requirement={requirement} />
          </div>
        )}

        {/* Governance actions — shown only when the state machine allows them */}
        {(status === "PENDING_ADMIN_REVIEW" || CORRECTABLE.includes(status) || RERUNNABLE.includes(status)) && (
          <div className="border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap gap-2">
              {status === "PENDING_ADMIN_REVIEW" && (
                <button
                  type="button"
                  disabled={openFlags > 0}
                  title={openFlags > 0 ? "Confirm the extraction warnings first" : undefined}
                  onClick={() => setDecision("approve")}
                  className="px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-xs font-bold disabled:opacity-40"
                >
                  Approve Requirement
                </button>
              )}
              {CORRECTABLE.includes(status) && (
                <button type="button" onClick={() => setDecision("correction")} className="px-4 py-2 rounded-lg bg-orange-50 text-orange-700 text-xs font-bold">
                  Request Correction
                </button>
              )}
              {status === "PENDING_ADMIN_REVIEW" && (
                <button type="button" onClick={() => setDecision("reject")} className="px-4 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-bold">
                  Reject
                </button>
              )}
              {RERUNNABLE.includes(status) && requirement.hasDocument && (
                <button type="button" disabled={!!busy} onClick={rerun} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-800 text-xs font-bold disabled:opacity-50">
                  {busy === "rerun" ? "Re-running extraction…" : "Re-run Extraction"}
                </button>
              )}
            </div>
            {decision && (
              <div className="space-y-2">
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    decision === "approve"
                      ? "Optional note for the record"
                      : decision === "correction"
                      ? "Tell the donor exactly what to correct (shown to the donor)"
                      : "Reason for rejection (shown to the donor)"
                  }
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-trust-500"
                />
                {decision === "approve" && dirty && (
                  <p className="text-xs text-blue-700">Your unsaved field corrections will be saved first, then the requirement is validated.</p>
                )}
                <div className="flex gap-2">
                  <button type="button" disabled={!!busy} onClick={confirmDecision} className="px-4 py-2 rounded-lg bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 text-xs font-bold disabled:opacity-50">
                    {busy ? "Working…" : `Confirm ${decision === "approve" ? "approval" : decision === "correction" ? "correction request" : "rejection"}`}
                  </button>
                  <button type="button" onClick={() => setDecision(null)} className="px-4 py-2 rounded-lg text-gray-500 text-xs font-semibold">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <aside className="lg:col-span-4 space-y-4">
            <div className="border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] rounded-2xl p-5 space-y-3">
              <h2 className="text-sm font-bold text-gray-900">Original document</h2>
              {requirement.isFormEntry ? (
                <p className="text-xs text-gray-500">No document — the donor entered this requirement through the structured form. Every value is donor-provided.</p>
              ) : (
              <>
              <p className="text-[11px] text-gray-500">
                {requirement.mimeType || "unknown type"} · {(requirement.fileSize / 1024).toFixed(0)} KB · SHA-256 {requirement.fileHash.slice(0, 16)}…
                <br />
                Access is logged in the audit trail.
              </p>
              <DocumentPreview requirementId={id} fileName={requirement.fileName} mimeType={requirement.mimeType} hasDocument={requirement.hasDocument} />
              </>
              )}
            </div>
            {requirement.reviewNote && (
              <div className="border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] rounded-2xl p-5 text-xs text-gray-700">
                <p className="font-bold text-gray-800 mb-1">Last review note</p>
                <p className="whitespace-pre-wrap">{requirement.reviewNote}</p>
              </div>
            )}
            {!requirement.isFormEntry && (
              <details className="border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] rounded-2xl p-5 text-xs">
                <summary className="cursor-pointer font-bold text-gray-800">Text read from the document</summary>
                <pre className="mt-3 max-h-96 overflow-y-auto font-mono text-gray-500 whitespace-pre-wrap">{requirement.rawText || "No text extracted."}</pre>
              </details>
            )}
          </aside>

          <div className="lg:col-span-8 space-y-4">
            <div className="flex flex-wrap gap-2 border-b border-gray-200">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-xs font-bold capitalize border-b-2 -mb-px ${
                    tab === t ? "border-trust-600 text-trust-700" : "border-transparent text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {t === "history" ? "Version history" : t === "audit" ? "Audit trail" : t}
                </button>
              ))}
            </div>

            {tab === "requirements" && (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">
                  Provenance: <span className="text-gray-700">AI</span> = extracted by the agent,{" "}
                  <span className="text-blue-700">Donor corrected</span>, <span className="text-emerald-700">Admin verified</span>.
                  {editable ? " You can correct fields before approving." : ""}
                </p>
                <ExtractionMethodBanner requirement={requirement} />
                <ExtractionFlagsPanel flags={requirement.extractionFlags} canConfirm={editable} onConfirm={confirmFlag} busy={busy} />
                <FieldsEditor fields={requirement.fields} editable={editable} draft={draft} onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
                {editable && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!dirty || !!busy}
                      onClick={saveEdits}
                      className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-800 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40"
                    >
                      {busy === "save" ? "Saving…" : "Save corrections"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === "history" && (
              <VersionHistory
                current={{
                  version: requirement.version,
                  versionNote: requirement.versionNote,
                  versionAuthorRole: requirement.versionAuthorRole,
                  updatedAt: requirement.updatedAt,
                  fields: requirement.fields,
                }}
                revisions={requirement.revisions ?? []}
              />
            )}

            {tab === "matches" && matchRun && (
              <div className="space-y-4">
                <div className="border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-bold text-gray-800">Reject this matching analysis</p>
                  <textarea
                    rows={2}
                    value={runNote}
                    onChange={(e) => setRunNote(e.target.value)}
                    placeholder="Note (required) — approve candidates with the shortlist review above"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!!busy} onClick={() => reviewRun("request-reanalysis")} className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold disabled:opacity-50">
                      Request re-analysis
                    </button>
                    <button type="button" disabled={!!busy} onClick={() => reviewRun("reject")} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-bold disabled:opacity-50">
                      Reject analysis
                    </button>
                  </div>
                </div>
                {canReviewShortlist && <ShortlistReview run={matchRun} onSubmit={approveShortlist} busy={busy === "shortlist"} />}
                <MatchResults
                  run={matchRun}
                  canInvite={status === "SHORTLISTED" || status === "NGO_RESPONSE"}
                  onInvite={(matchId) =>
                    perform(`invite:${matchId}`, () => post(`matches/${matchId}/invite`), "Opportunity brief shared with the NGO.")
                  }
                  invitingId={busy?.startsWith("invite:") ? busy.slice(7) : null}
                />
              </div>
            )}

            {tab === "responses" && (
              <ResponsesPanel
                responses={responses}
                canSelect={status === "NGO_RESPONSE"}
                onSelect={(responseId) => {
                  if (!window.confirm("Approve this proposal on the donor's behalf? Every other proposal will be declined.")) return;
                  perform(`select:${responseId}`, () => post("select", { responseId }), "Proposal approved — ready for contracting.");
                }}
                onRequestChanges={async (responseId, note) => {
                  let ok = false;
                  await perform(
                    `changes:${responseId}`,
                    async () => {
                      await post(`responses/${responseId}/request-changes`, { note });
                      ok = true;
                    },
                    "Change request sent to the organisation."
                  );
                  return ok;
                }}
                busyId={busy}
              />
            )}

            {tab === "audit" && <AuditTrail events={events} />}
          </div>
        </div>
      </div>
    </div>
  );
}
