"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MatchRunDTO, RequirementDTO } from "@/lib/requirements/dto";
import type { ResponseItem } from "@/lib/requirements/queries";
import { DONOR_EDITABLE, POST_VALIDATION } from "@/lib/requirements/status";
import { StatusBadge } from "@/components/requirements/StatusBadge";
import { RequirementStepper } from "@/components/requirements/RequirementStepper";
import { FieldsEditor, initialDraft, draftEdits, type FieldDraft } from "@/components/requirements/FieldsEditor";
import { VersionHistory } from "@/components/requirements/VersionHistory";
import { DocumentPreview } from "@/components/requirements/DocumentPreview";
import { MatchResults } from "@/components/requirements/MatchResults";
import { ResponsesPanel } from "@/components/requirements/ResponsesPanel";
import { requirementApi } from "@/components/requirements/api";

type Tab = "requirements" | "document" | "history" | "matches" | "responses";
const TABS: Tab[] = ["requirements", "document", "history", "matches", "responses"];
const RESPONSE_STAGE = ["SHORTLISTED", "NGO_RESPONSE", "SELECTED", "CONTRACTED"];

export default function RequirementDetailClient({
  requirement,
  matchRun,
  responses,
  contract,
  initialTab,
  duplicate,
  created = false,
}: {
  requirement: RequirementDTO;
  matchRun: MatchRunDTO | null;
  responses: ResponseItem[];
  contract: { id: string; contractNumber: string; status: string } | null;
  initialTab?: string;
  duplicate: boolean;
  created?: boolean;
}) {
  const router = useRouter();
  const { id, status } = requirement;
  const editable = (DONOR_EDITABLE as string[]).includes(status);
  const postValidation = (POST_VALIDATION as string[]).includes(status);
  const showMatches = postValidation || !!matchRun;
  const showResponses = responses.length > 0 || RESPONSE_STAGE.includes(status);
  const tabs = TABS.filter((t) =>
    t === "matches" ? showMatches : t === "responses" ? showResponses : t === "document" ? !requirement.isFormEntry : true
  );

  const defaultTab: Tab = status === "NGO_RESPONSE" ? "responses" : postValidation ? "matches" : "requirements";
  const [tab, setTab] = useState<Tab>(tabs.includes(initialTab as Tab) ? (initialTab as Tab) : defaultTab);
  const [draft, setDraft] = useState<FieldDraft>(() => initialDraft(requirement.fields));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    duplicate
      ? "An identical CSR document has already been uploaded — this is your existing record."
      : created
      ? "Requirement created. Review it below, then submit it for admin verification."
      : null
  );
  const [showRaw, setShowRaw] = useState(false);

  // After router.refresh() the server sends the new version; reset the draft to it.
  useEffect(() => {
    setDraft(initialDraft(requirement.fields));
  }, [requirement.version, requirement.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const edits = draftEdits(requirement.fields, draft);
  const dirty = Object.keys(edits).length > 0;
  const invitedAny = !!matchRun?.matches.some((m) => m.invitedAt);

  async function perform(label: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const saveEdits = () => requirementApi(`/api/requirements/${id}`, { method: "PUT", body: JSON.stringify({ fields: edits }) });

  const save = () => perform("save", saveEdits, "Changes saved as a new version.");
  const submit = () =>
    perform(
      "submit",
      async () => {
        if (dirty) await saveEdits();
        await requirementApi(`/api/requirements/${id}/submit-review`, { method: "POST" });
      },
      "Submitted for admin verification. You'll be able to find matches once an admin validates it."
    );
  const retry = () => perform("retry", () => requirementApi(`/api/requirements/${id}/rerun-extraction`, { method: "POST" }), "Extraction complete.");
  const findMatches = () =>
    perform("match", async () => {
      await requirementApi(`/api/requirements/${id}/matches`, { method: "POST" });
      setTab("matches");
    });
  const invite = (matchId: string) =>
    perform(
      `invite:${matchId}`,
      () => requirementApi(`/api/requirements/${id}/matches/${matchId}/invite`, { method: "POST" }),
      "Opportunity brief shared. The NGO sees only the sanitized brief, not your document."
    );
  const select = (responseId: string) => {
    if (!window.confirm("Select this NGO? The other responses will be declined and this cannot be undone.")) return;
    perform(
      `select:${responseId}`,
      () => requirementApi(`/api/requirements/${id}/select`, { method: "POST", body: JSON.stringify({ responseId }) }),
      "NGO selected. You can now initiate the grant contract."
    );
  };

  return (
    <div className="px-6 lg:px-10 py-10 max-w-6xl space-y-6">
      <div>
        <Link href="/donor/requirements" className="text-xs font-bold text-emerald-400 hover:underline">
          ← My CSR Documents
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="text-2xl font-extrabold text-white break-all">{requirement.fileName}</h1>
          <StatusBadge status={status} />
          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-300">v{requirement.version}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {requirement.isFormEntry
            ? `Created ${new Date(requirement.createdAt).toLocaleString("en-IN")} · Entered via the requirement form`
            : `Uploaded ${new Date(requirement.createdAt).toLocaleString("en-IN")} · Extracted with ${requirement.modelVersion}`}
        </p>
        <div className="mt-4">
          <RequirementStepper status={status} />
        </div>
      </div>

      {notice && <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-4 py-2">{notice}</p>}
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-2">{error}</p>}

      {/* Status-specific guidance and the one primary action for this stage */}
      <div className="border border-gray-800 bg-gray-900/40 rounded-2xl p-5 text-sm text-gray-300">
        {status === "UPLOADED" || status === "PROCESSING" ? (
          <p>Processing the document and extracting requirements…</p>
        ) : status === "FAILED" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-red-300">Document processing failed. You can retry extraction.</p>
            <button type="button" disabled={!!busy} onClick={retry} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-950 text-xs font-bold disabled:opacity-50">
              {busy === "retry" ? "Retrying…" : "Retry extraction"}
            </button>
          </div>
        ) : (status === "AI_EXTRACTED" || status === "DONOR_REVIEW") && requirement.isFormEntry ? (
          <p>Check the details you entered and fill any gaps — sector, location, budget and KPIs drive NGO matching — then submit for admin verification.</p>
        ) : status === "AI_EXTRACTED" || status === "DONOR_REVIEW" ? (
          <p>Review the extracted requirements below. Correct anything that is wrong — especially fields marked ⚠ — then submit them for admin verification.</p>
        ) : status === "NEEDS_CORRECTION" ? (
          <div className="space-y-1">
            <p className="text-orange-300 font-semibold">An admin asked for corrections:</p>
            <p className="whitespace-pre-wrap">{requirement.reviewNote}</p>
            <p className="text-xs text-gray-500">Update the fields below and resubmit.</p>
          </div>
        ) : status === "PENDING_ADMIN_REVIEW" ? (
          <p>Awaiting admin verification. The requirement is read-only while it is reviewed.</p>
        ) : status === "REJECTED" ? (
          <div className="space-y-1">
            <p className="text-red-300 font-semibold">This requirement was rejected by an admin:</p>
            <p className="whitespace-pre-wrap">{requirement.reviewNote}</p>
          </div>
        ) : status === "VALIDATED" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              Validated by an admin{requirement.validatedAt ? ` on ${new Date(requirement.validatedAt).toLocaleDateString("en-IN")}` : ""}.
              Find compatible NGO projects next.
            </p>
            <button type="button" disabled={!!busy} onClick={findMatches} className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-xs font-bold disabled:opacity-50">
              {busy === "match" ? "Finding compatible NGOs…" : "Find Matches"}
            </button>
          </div>
        ) : status === "MATCHING" ? (
          <p>Finding compatible NGOs…</p>
        ) : status === "SHORTLISTED" ? (
          <p>Your ranked shortlist is ready. Invite the NGOs you want to hear from — they receive a sanitized brief, never your document.</p>
        ) : status === "NGO_RESPONSE" ? (
          <p>NGOs have responded. Review their proposals and select one.</p>
        ) : status === "SELECTED" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>You selected an NGO. Initiate the grant contract — it will be prefilled from this requirement and the NGO&apos;s proposal.</p>
            <Link href={`/donor/contracts/new?requirementId=${id}`} className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-xs font-bold">
              Initiate Contract
            </Link>
          </div>
        ) : status === "CONTRACTED" && contract ? (
          <p>
            Contracted —{" "}
            <Link href={`/donor/contracts/${contract.id}`} className="text-emerald-400 font-semibold hover:underline">
              {contract.contractNumber}
            </Link>{" "}
            ({contract.status.toLowerCase()}).
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-800">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-bold capitalize border-b-2 -mb-px transition ${
              tab === t ? "border-emerald-400 text-emerald-300" : "border-transparent text-gray-500 hover:text-gray-200"
            }`}
          >
            {t === "history" ? "Version history" : t === "responses" ? `NGO responses (${responses.length})` : t}
          </button>
        ))}
      </div>

      {tab === "requirements" && (
        <div className="space-y-4">
          <FieldsEditor fields={requirement.fields} editable={editable} draft={draft} onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
          {editable && (
            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={!dirty || !!busy}
                onClick={save}
                className="px-5 py-2.5 rounded-xl border border-gray-700 text-gray-200 text-sm font-semibold hover:bg-gray-800 disabled:opacity-40"
              >
                {busy === "save" ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={submit}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 text-gray-950 text-sm font-bold disabled:opacity-50"
              >
                {busy === "submit" ? "Submitting…" : "Submit for Admin Verification"}
              </button>
            </div>
          )}
          {requirement.rawText !== undefined && !requirement.isFormEntry && (
            <div className="border border-gray-800 rounded-2xl p-4">
              <button type="button" onClick={() => setShowRaw((s) => !s)} className="text-xs font-semibold text-emerald-400">
                {showRaw ? "Hide" : "Show"} text read from the document
              </button>
              {showRaw && (
                <pre className="mt-3 max-h-96 overflow-y-auto text-xs font-mono text-gray-400 whitespace-pre-wrap">
                  {requirement.rawText || "No text extracted."}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "document" && (
        <div className="border border-gray-800 bg-gray-900/40 rounded-2xl p-5 space-y-2">
          <p className="text-xs text-gray-500">
            {requirement.fileName} · {(requirement.fileSize / 1024).toFixed(0)} KB · SHA-256 {requirement.fileHash.slice(0, 16)}…
          </p>
          <DocumentPreview requirementId={id} fileName={requirement.fileName} mimeType={requirement.mimeType} hasDocument={requirement.hasDocument} />
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

      {tab === "matches" && (
        <div className="space-y-4">
          {status === "SHORTLISTED" && !invitedAny && (
            <div className="flex justify-end">
              <button type="button" disabled={!!busy} onClick={findMatches} className="text-xs font-semibold text-gray-400 hover:text-white disabled:opacity-50">
                {busy === "match" ? "Re-running…" : "↻ Re-run matching"}
              </button>
            </div>
          )}
          {matchRun ? (
            <MatchResults
              run={matchRun}
              canInvite={status === "SHORTLISTED" || status === "NGO_RESPONSE"}
              onInvite={invite}
              invitingId={busy?.startsWith("invite:") ? busy.slice(7) : null}
            />
          ) : (
            <p className="text-sm text-gray-400">No matching run yet. Use “Find Matches” above.</p>
          )}
        </div>
      )}

      {tab === "responses" && (
        <ResponsesPanel
          responses={responses}
          canSelect={status === "NGO_RESPONSE"}
          onSelect={select}
          selectingId={busy?.startsWith("select:") ? busy.slice(7) : null}
        />
      )}
    </div>
  );
}
