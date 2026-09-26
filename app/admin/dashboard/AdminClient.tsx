"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import AskNgoBox from "@/app/admin/components/AskNgoBox";

interface ScreeningChecklistEntry {
  present: boolean;
  readable: boolean;
  note?: string;
}

interface ExtractedFieldRow {
  fieldKey: string;
  extractedValue: string | null;
  submittedValue: string | null;
  matchesSubmitted: boolean | null;
  confidence: number;
  status: string;
  flags: { severity: string; issue: string }[];
}

interface OpenRiskReview {
  id: string;
  riskLevel: string;
  findings: { fieldKey: string | null; severity: string; issue: string }[];
}

interface NGO {
  id: string;
  orgName: string;
  registrationNumber: string;
  panNumber: string;
  address: string;
  causeCategories: string[];
  website: string | null;
  foundedYear: number;
  documents: string[];
  createdAt: Date;
  extractedFields: ExtractedFieldRow[];
  openRiskReview: OpenRiskReview | null;
  /**
   * Non-null when this organisation is already VERIFIED but the document
   * evidence behind that approval has since failed. It is live, listed, and
   * raising money right now — which is why these sort to the top of the queue.
   */
  /**
   * Front-gate flags, computed in lib/verification-queue.ts so the button and
   * the API cannot disagree about what is approvable. The server refuses these
   * cases regardless; showing an Approve button that will be rejected just
   * moves the refusal to after the click.
   */
  hasDocuments?: boolean;
  hasExtraction?: boolean;
  hasIdentityContradiction?: boolean;
  reverificationRequiredAt?: string | null;
  reverificationReason?: string | null;
  reverificationDueAt?: string | null;
  verificationStatus?: string;
  /** What the automated check verified — shown before an admin approves. */
  assurances: string[];
  user: {
    email: string;
  };
}

interface AdminClientProps {
  initialPendingNGOs: NGO[];
}

/**
 * One document-analysis pass produces the evidence rows; lib/verification-triage.ts
 * decides whether the profile is clean or belongs in Risk & Compliance. This is
 * the only verdict the console shows — there is no separate screening summary or
 * AI pre-check panel any more, because those were two more passes over the same
 * PDFs whose answers nobody acted on.
 */
function verdictOf(ngo: NGO): "SAFE" | "RISK" | "NOT_ANALYSED" {
  if (ngo.openRiskReview) return "RISK";
  if (!ngo.extractedFields || ngo.extractedFields.length === 0) return "NOT_ANALYSED";
  return "SAFE";
}

export default function AdminClient({ initialPendingNGOs }: AdminClientProps) {
  const router = useRouter();
  const [ngos, setNgos] = useState<NGO[]>(initialPendingNGOs);
  
  // Collapsible AI precheck panel state
  const [expandedNgoId, setExpandedNgoId] = useState<string | null>(null);
  
  // Modal states
  const [selectedNgo, setSelectedNgo] = useState<NGO | null>(null);
  const [actionType, setActionType] = useState<"APPROVE" | "REJECT" | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [reminderSending, setReminderSending] = useState(false);
  const [reminderResult, setReminderResult] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterRec, setFilterRec] = useState<"ALL" | "SAFE" | "RISK" | "NOT_ANALYSED">("ALL");

  const filteredNgos = ngos.filter((ngo) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      ngo.orgName.toLowerCase().includes(q) ||
      ngo.user.email.toLowerCase().includes(q) ||
      ngo.registrationNumber.toLowerCase().includes(q) ||
      ngo.panNumber.toLowerCase().includes(q);

    const matchesFilter = filterRec === "ALL" || verdictOf(ngo) === filterRec;

    return matchesSearch && matchesFilter;
  });

  const sendReminders = async () => {
    setReminderSending(true);
    setReminderResult(null);
    try {
      const res = await fetch("/api/admin/send-reminders", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const r = data.results;
      const parts = [];
      if (r.pendingNGOs?.sent) parts.push(`${r.pendingNGOs.count} pending NGO reminder(s)`);
      if (r.unreviewedProofs?.sent) parts.push(`${r.unreviewedProofs.count} proof reminder(s)`);
      if (r.fraudAlerts?.sent) parts.push(`${r.fraudAlerts.count} fraud alert reminder(s)`);
      if (r.documentErrors?.sent) parts.push(`${r.documentErrors.count} document error reminder(s)`);
      setReminderResult(parts.length > 0 ? `Sent: ${parts.join(", ")}` : "No reminders needed right now.");
    } catch (err: any) {
      setReminderResult("Error: " + err.message);
    } finally {
      setReminderSending(false);
    }
  };

  // Re-running analysis only produces evidence — it never changes NGO status.
  const [analysisLoadingId, setAnalysisLoadingId] = useState<string | null>(null);

  const rerunAnalysis = async (ngoId: string) => {
    setAnalysisLoadingId(ngoId);
    try {
      const res = await fetch("/api/admin/extract-ngo-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ngoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      router.refresh();
    } catch (err) {
      console.error("Re-run analysis error:", err);
    } finally {
      setAnalysisLoadingId(null);
    }
  };

  const openModal = (ngo: NGO, type: "APPROVE" | "REJECT") => {
    setSelectedNgo(ngo);
    setActionType(type);
    setAdminNote(type === "APPROVE" ? "All documents verified successfully." : "");
    setError("");
    setOverrideConfirmed(false);
  };

  const closeModal = () => {
    setSelectedNgo(null);
    setActionType(null);
    setAdminNote("");
    setError("");
    setOverrideConfirmed(false);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNgo || !actionType) return;
    
    if (actionType === "REJECT" && !adminNote.trim()) {
      setError("A rejection note is mandatory so the NGO knows what to fix.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/verify-ngo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ngoId: selectedNgo.id,
          action: actionType,
          adminNote: adminNote.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to submit verification status");
      }

      // Update local NGO list
      setNgos((prev) => prev.filter((n) => n.id !== selectedNgo.id));
      closeModal();
      router.refresh();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const FIELD_LABELS: Record<string, string> = {
    orgName: "Organisation name",
    registrationNumber: "Registration number",
    panNumber: "PAN number",
    a12Number: "12A number",
    eightyGNumber: "80G number",
  };

  const renderVerificationPanel = (ngo: NGO) => {
    const verdict = verdictOf(ngo);
    const isBusy = analysisLoadingId === ngo.id;

    const rerunButton = (
      <button
        onClick={() => rerunAnalysis(ngo.id)}
        disabled={isBusy}
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 disabled:opacity-50 text-gray-600 dark:text-gray-300 text-xs font-bold py-1.5 px-3 rounded-lg transition flex items-center gap-1.5 shrink-0"
      >
        {isBusy && <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-500"></div>}
        {isBusy ? "Analysing…" : "Re-run analysis"}
      </button>
    );

    // Never analysed. Critically this must NOT read as "clean" — an NGO with no
    // evidence rows is the state the whole evidence chain exists to prevent.
    if (verdict === "NOT_ANALYSED") {
      return (
        <div className="border border-red-200 dark:border-red-900/50 rounded-2xl p-5 bg-red-50/40 dark:bg-red-950/10 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-black text-red-700 dark:text-red-400">Not analysed</h4>
            {rerunButton}
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 font-semibold">
            No document evidence exists for this organisation. Approving now would set compliance
            flags with nothing behind them.
          </p>
        </div>
      );
    }

    const risk = ngo.openRiskReview;

    return (
      <div
        className={`border rounded-2xl p-5 space-y-4 ${
          risk
            ? "border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/10"
            : "border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/10"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-black text-gray-900 dark:text-white">
              {risk ? "Sent to Risk & Compliance" : "Documents read cleanly"}
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400 font-semibold mt-0.5">
              {risk
                ? `${risk.findings?.length ?? 0} issue(s) found · ${risk.riskLevel} risk`
                : "Every identity field matches the registration form."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {risk && (
              <a
                href="/admin/risk-compliance"
                className="text-xs font-bold text-red-600 hover:underline"
              >
                Open in Risk &amp; Compliance →
              </a>
            )}
            {rerunButton}
          </div>
        </div>

        {/* Why this looks safe. An admin approving on a machine verdict is
            entitled to see what was actually checked — a bare "clean" asks them
            to rubber-stamp something they cannot inspect. */}
        {!risk && ngo.assurances?.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              What was checked
            </span>
            {ngo.assurances.map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-emerald-600 font-black shrink-0">✓</span>
                <span className="text-gray-700 dark:text-gray-300 font-semibold">{a}</span>
              </div>
            ))}
            <p className="text-[10px] text-gray-500 dark:text-gray-400 italic pt-1">
              These are mechanical checks on what the documents say. They do not confirm the
              documents are genuine — that judgment is yours.
            </p>
          </div>
        )}

        {risk && risk.findings?.length > 0 && (
          <div className="space-y-1.5">
            {risk.findings.map((f, i) => {
              const badge =
                f.severity === "HIGH"
                  ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                  : f.severity === "MEDIUM"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
                  : "bg-gray-100 text-gray-600";
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 text-xs bg-white/60 dark:bg-gray-950/20 p-2 rounded-lg border border-gray-100 dark:border-gray-850"
                >
                  <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 ${badge}`}>
                    {f.severity}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300 font-semibold">{f.issue}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-white/60 dark:bg-gray-950/20 p-3.5 rounded-xl border border-gray-100 dark:border-gray-850">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
            Evidence read from the documents
          </span>
          <div className="space-y-1.5">
            {ngo.extractedFields.map((f) => (
              <div key={f.fieldKey} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-gray-600 dark:text-gray-300 shrink-0">
                  {FIELD_LABELS[f.fieldKey] ?? f.fieldKey}
                </span>
                <span className="font-bold text-gray-900 dark:text-white truncate">
                  {f.extractedValue ?? "— not found —"}
                </span>
                <span
                  className={`text-[10px] font-extrabold shrink-0 ${
                    f.status === "VALIDATED"
                      ? "text-emerald-600"
                      : f.status === "REJECTED"
                      ? "text-red-500"
                      : f.status === "EXTRACTED"
                      ? "text-gray-500"
                      : "text-amber-600"
                  }`}
                >
                  {Math.round((f.confidence || 0) * 100)}% · {f.status}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 italic mt-2">
            Values read by a model, held to code-level format and cross-checks. Validate each one in
            Document Review — only a validated field earns its compliance flag.
          </p>
        </div>
      </div>
    );
  };

  const isVerifySubmitDisabled = loading || (
    actionType === "APPROVE" &&
    selectedNgo?.openRiskReview?.riskLevel === "HIGH" &&
    (!overrideConfirmed || !adminNote.trim())
  );

  return (
    <div className="space-y-6">

      {/* Reminder trigger — for demo and manual use */}
      <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl">
        <div className="flex-1">
          <p className="text-sm font-bold text-blue-900 dark:text-blue-200">Admin Reminder System</p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
            Sends reminder emails for: pending NGOs (&gt;5 days), unreviewed proofs (&gt;3 days), unresolved fraud alerts (&gt;7 days), and NGO document errors (&gt;7 days).
          </p>
          {reminderResult && (
            <p className={`text-xs font-semibold mt-1.5 ${reminderResult.startsWith("Error") ? "text-red-600" : "text-emerald-600"}`}>
              {reminderResult}
            </p>
          )}
        </div>
        <button
          onClick={sendReminders}
          disabled={reminderSending}
          className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition"
        >
          {reminderSending ? "Sending..." : "Send Reminders Now"}
        </button>
      </div>

      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search by org name, email, reg number, PAN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {(["ALL", "SAFE", "RISK", "NOT_ANALYSED"] as const).map((val) => {
            const labels: Record<string, string> = { ALL: "All", SAFE: "Clean", RISK: "At risk", NOT_ANALYSED: "Not analysed" };
            const colors: Record<string, string> = {
              ALL: filterRec === "ALL" ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700",
              SAFE: filterRec === "SAFE" ? "bg-emerald-600 text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700",
              RISK: filterRec === "RISK" ? "bg-red-600 text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700",
              NOT_ANALYSED: filterRec === "NOT_ANALYSED" ? "bg-amber-500 text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700",
            };
            return (
              <button key={val} onClick={() => setFilterRec(val)} className={`px-3 py-2 text-xs font-bold rounded-xl transition ${colors[val]}`}>
                {labels[val]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results count */}
      {(search || filterRec !== "ALL") && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Showing {filteredNgos.length} of {ngos.length} applications
          {search && <span> matching <span className="font-semibold text-gray-700 dark:text-gray-300">"{search}"</span></span>}
        </p>
      )}

      {ngos.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
          <span className="text-4xl mb-4 block">🎉</span>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">All caught up!</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            There are currently no pending NGO registration documents awaiting review.
          </p>
        </div>
      ) : filteredNgos.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/>
          </svg>
          <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">No results found</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">No NGOs match your search or filter. Try adjusting your criteria.</p>
          <button onClick={() => { setSearch(""); setFilterRec("ALL"); }} className="mt-4 text-xs font-semibold text-emerald-600 hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">NGO Details</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Credentials</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Documents</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                {filteredNgos.map((ngo) => (
                  <React.Fragment key={ngo.id}>
                    <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="px-6 py-4">
                        <a href={`/admin/ngos/${ngo.id}`} className="text-sm font-bold text-gray-900 dark:text-white hover:text-emerald-600 hover:underline">
                          {ngo.orgName}
                        </a>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{ngo.user.email}</div>
                        <div className="text-xs text-gray-400 mt-0.5">Founded: {ngo.foundedYear}</div>
                        {/* The verdict belongs HERE, next to the name — not
                            hidden behind the expand button. An admin decides
                            from this row, so anything that should change the
                            decision has to be visible before they reach the
                            Approve button. */}
                        {(ngo.hasDocuments === false || ngo.hasExtraction === false || ngo.hasIdentityContradiction) && (
                          <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500 text-white">
                              CANNOT APPROVE YET
                            </span>
                            <p className="mt-1 text-xs text-amber-900 dark:text-amber-300">
                              {ngo.hasDocuments === false
                                ? "No documents have been uploaded. There is nothing to verify — ask the organisation to submit them."
                                : ngo.hasExtraction === false
                                  ? "The documents have never been analysed, so there is no evidence to approve on. Run extraction from Document Review."
                                  : "The documents contradict the registration form about who this organisation is. This is not something a note can settle — correct or validate the field in Document Review, or reject."}
                            </p>
                          </div>
                        )}

                        {ngo.reverificationRequiredAt && (
                          <div className="mt-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-600 text-white">
                                RE-DECISION NEEDED
                              </span>
                              <span className="text-[11px] font-bold text-red-700 dark:text-red-400">
                                Approved earlier — evidence has since failed
                              </span>
                              {ngo.reverificationDueAt && (
                                <span
                                  className={`text-[11px] font-bold ${
                                    new Date(ngo.reverificationDueAt) < new Date()
                                      ? "text-red-700 dark:text-red-400"
                                      : "text-gray-500 dark:text-gray-400"
                                  }`}
                                >
                                  {new Date(ngo.reverificationDueAt) < new Date()
                                    ? "OVERDUE"
                                    : `due ${new Date(ngo.reverificationDueAt).toLocaleDateString("en-IN", {
                                        day: "numeric",
                                        month: "short",
                                      })}`}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-red-800 dark:text-red-300">{ngo.reverificationReason}</p>
                            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">
                              It has not been suspended and its profile is still live — nothing happens to it until you
                              decide.
                            </p>
                          </div>
                        )}

                        <div className="mt-1.5">
                          {(() => {
                            const verdict = verdictOf(ngo);
                            if (verdict === "RISK") {
                              const level = ngo.openRiskReview?.riskLevel ?? "";
                              const count = ngo.openRiskReview?.findings?.length ?? 0;
                              return (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200/60 dark:border-red-900/60">
                                  ⚠ AT RISK · {level} · {count} finding{count === 1 ? "" : "s"}
                                </span>
                              );
                            }
                            if (verdict === "NOT_ANALYSED") {
                              return (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200/60 dark:border-amber-900/60">
                                  NOT ANALYSED · no evidence
                                </span>
                              );
                            }
                            return (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-900/60">
                                ✓ DOCUMENTS CLEAN
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {ngo.causeCategories.map((c) => (
                            <span key={c} className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded">
                              {c}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-gray-700 dark:text-gray-300">
                          <strong className="font-semibold">Reg No:</strong> {ngo.registrationNumber}
                        </div>
                        <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
                          <strong className="font-semibold">PAN:</strong> {ngo.panNumber}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm space-y-1">
                        {ngo.documents.map((doc, idx) => (
                          <a
                            key={doc}
                            href={doc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 font-semibold underline"
                          >
                            Document {idx + 1} (PDF)
                          </a>
                        ))}
                      </td>
                      <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                        <AskNgoBox
                          ngoId={ngo.id}
                          ngoName={ngo.orgName}
                          subject="Question about your registration documents"
                          entityType="NGO_VERIFICATION"
                          entityId={ngo.id}
                          buttonLabel="✉️ Ask"
                        />
                        <button
                          onClick={() => setExpandedNgoId(expandedNgoId === ngo.id ? null : ngo.id)}
                          className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold py-1.5 px-3 rounded-lg text-xs transition"
                        >
                          {expandedNgoId === ngo.id ? "Hide evidence" : "Evidence"}
                        </button>
                        {(() => {
                          // Why approval is unavailable, in the order a person
                          // would fix them: get documents, read them, resolve
                          // the contradiction.
                          const blocker =
                            ngo.hasDocuments === false
                              ? "No documents uploaded — nothing to verify."
                              : ngo.hasExtraction === false
                                ? "Documents have never been analysed. Run extraction in Document Review first."
                                : ngo.hasIdentityContradiction
                                  ? "The documents contradict the form about who this organisation is. Resolve it in Document Review, or reject."
                                  : null;

                          if (blocker) {
                            return (
                              <span
                                title={blocker}
                                className="bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 font-bold py-1.5 px-3 rounded-lg text-xs cursor-not-allowed border border-gray-200 dark:border-gray-700"
                              >
                                Approve blocked
                              </span>
                            );
                          }

                          return (
                            <button
                              onClick={() => openModal(ngo, "APPROVE")}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition"
                            >
                              Approve
                            </button>
                          );
                        })()}
                        <button
                          onClick={() => openModal(ngo, "REJECT")}
                          className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 hover:bg-red-100 font-bold py-1.5 px-3 rounded-lg text-xs transition"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                    {expandedNgoId === ngo.id && (
                      <tr>
                        <td colSpan={4} className="bg-gray-50/30 dark:bg-gray-950/10 px-8 py-5 border-b border-gray-200 dark:border-gray-800 space-y-5">
                          {renderVerificationPanel(ngo)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Dialog */}
      {selectedNgo && actionType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 dark:border-gray-800">
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-2">
              {actionType === "APPROVE" ? "Approve NGO" : "Reject NGO Application"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {actionType === "APPROVE"
                ? `Confirming verification for "${selectedNgo.orgName}". An approval notice will be sent.`
                : `Enter the rejection reason for "${selectedNgo.orgName}". The NGO will be required to update credentials.`}
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 rounded">
                {error}
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              
              {/* AI Override warning callout & checkbox */}
              {actionType === "APPROVE" && selectedNgo.openRiskReview?.riskLevel === "HIGH" && (
                <div className="p-4 bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500 rounded text-xs text-red-800 dark:text-red-300 space-y-2">
                  <p className="font-extrabold flex items-center gap-1.5 text-red-750 dark:text-red-400">
                    ⚠️ Overriding a HIGH risk finding
                  </p>
                  <p className="font-semibold text-gray-700 dark:text-gray-300">
                    The AI flagged this NGO as possible fraud. Are you sure you want to approve? Please justify in your note.
                  </p>
                  <label className="flex items-center gap-2 mt-2 font-bold cursor-pointer select-none text-red-700 dark:text-red-400">
                    <input
                      type="checkbox"
                      checked={overrideConfirmed}
                      onChange={(e) => setOverrideConfirmed(e.target.checked)}
                      className="rounded text-red-650 focus:ring-red-550 border-gray-300 dark:border-gray-700"
                      required
                    />
                    I confirm overriding the AI fraud flag
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Administrator Note *
                </label>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={4}
                  required={actionType === "REJECT" || (actionType === "APPROVE" && selectedNgo.openRiskReview?.riskLevel === "HIGH")}
                  placeholder={
                    actionType === "REJECT"
                      ? "Specify why documents were rejected..."
                      : selectedNgo.openRiskReview?.riskLevel === "HIGH"
                      ? "Specify mandatory justification note for AI override..."
                      : "Add verification notes..."
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isVerifySubmitDisabled}
                  className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                    actionType === "APPROVE"
                      ? "bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      : "bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  }`}
                >
                  {loading && <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>}
                  {actionType === "APPROVE" ? "Confirm Approval" : "Confirm Rejection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
