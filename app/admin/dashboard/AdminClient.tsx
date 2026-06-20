"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

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
  ai_verification_report?: any;
  user: {
    email: string;
  };
}

interface AdminClientProps {
  initialPendingNGOs: NGO[];
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

  const renderAiPreCheckPanel = (ngo: NGO) => {
    const report = ngo.ai_verification_report;

    if (!report) {
      return (
        <div className="border border-gray-250 dark:border-gray-800 rounded-xl p-4 bg-gray-50/50 dark:bg-gray-900/30 text-gray-500 text-xs font-semibold flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          AI pre-check unavailable — please review documents manually
        </div>
      );
    }

    // Recommendation badge mapping
    let recBadgeClass = "bg-gray-100 text-gray-700 dark:bg-gray-850 dark:text-gray-300";
    let recLabel = "Review Required";
    if (report.recommendation === "APPROVE") {
      recBadgeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/50";
      recLabel = "Looks Good";
    } else if (report.recommendation === "REVIEW_CAREFULLY") {
      recBadgeClass = "bg-amber-100 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/50";
      recLabel = "Review Carefully";
    } else if (report.recommendation === "LIKELY_FRAUD") {
      recBadgeClass = "bg-red-100 text-red-850 dark:bg-red-950/30 dark:text-red-400 border border-red-200/50 dark:border-red-900/50";
      recLabel = "Possible Fraud";
    }

    // Consistency score bar mapping
    const score = report.consistency_score ?? 0;
    let scoreBarColor = "bg-red-500";
    if (score >= 80) scoreBarColor = "bg-emerald-500";
    else if (score >= 50) scoreBarColor = "bg-amber-500";

    // Helper checkmarks/cross logic for extracted fields vs form input
    const orgNameMatches = report.extracted_data?.org_name?.trim().toLowerCase() === ngo.orgName.trim().toLowerCase();
    const regMatches = report.extracted_data?.registration_number?.trim().toLowerCase() === ngo.registrationNumber.trim().toLowerCase();
    const panMatches = report.extracted_data?.pan_number?.trim().toLowerCase() === ngo.panNumber.trim().toLowerCase();

    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-inner space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-850 pb-4">
          <h4 className="text-sm font-black text-gray-900 dark:text-white flex items-center gap-1.5">
            🤖 AI Pre-Check Verification Report
          </h4>
          <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${recBadgeClass}`}>
            {recLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Score & Field Matching Checklist */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs font-bold text-gray-600 dark:text-gray-400 mb-1.5">
                <span>Consistency Score</span>
                <span>{score}%</span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${scoreBarColor}`} style={{ width: `${score}%` }}></div>
              </div>
            </div>

            <div className="space-y-2.5 bg-gray-50/50 dark:bg-gray-950/20 p-3.5 rounded-xl border border-gray-100 dark:border-gray-850">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Form Matching Verification</span>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-600 dark:text-gray-300">Org Name Match</span>
                <span className={orgNameMatches ? "text-emerald-600 font-extrabold flex items-center gap-0.5" : "text-red-500 font-extrabold flex items-center gap-0.5"}>
                  {orgNameMatches ? "✓ Match" : "✗ Mismatch"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-600 dark:text-gray-300">Reg Number Match</span>
                <span className={regMatches ? "text-emerald-600 font-extrabold flex items-center gap-0.5" : "text-red-500 font-extrabold flex items-center gap-0.5"}>
                  {regMatches ? "✓ Match" : "✗ Mismatch"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-600 dark:text-gray-300">PAN Number Match</span>
                <span className={panMatches ? "text-emerald-600 font-extrabold flex items-center gap-0.5" : "text-red-500 font-extrabold flex items-center gap-0.5"}>
                  {panMatches ? "✓ Match" : "✗ Mismatch"}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Extracted Document Details */}
          <div className="space-y-3 bg-gray-50/50 dark:bg-gray-955/20 p-3.5 rounded-xl border border-gray-100 dark:border-gray-850 text-xs">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Extracted Metadata</span>
            <div>
              <span className="text-[10px] text-gray-405 font-semibold block">Extracted Org Name</span>
              <span className="font-bold text-gray-900 dark:text-white">{report.extracted_data?.org_name || "N/A"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-gray-405 font-semibold block">Extracted Reg No</span>
                <span className="font-bold text-gray-900 dark:text-white">{report.extracted_data?.registration_number || "N/A"}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-405 font-semibold block">Extracted PAN</span>
                <span className="font-bold text-gray-900 dark:text-white">{report.extracted_data?.pan_number || "N/A"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-gray-455 font-semibold block">80G Cert Number</span>
                <span className="font-bold text-gray-900 dark:text-white">{report.extracted_data?.ngo_8og_number || "N/A"}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-455 font-semibold block">Validity / Dates</span>
                <span className="font-bold text-gray-900 dark:text-white">{report.extracted_data?.validity_notes || "N/A"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Text Box */}
        <div className="bg-emerald-50/30 dark:bg-emerald-950/10 border-l-4 border-emerald-500 rounded p-4">
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block mb-1">AI Audit Summary</span>
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
            {report.summary}
          </p>
        </div>

        {/* Audit Flags */}
        {report.flags && report.flags.length > 0 && (
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Security & Validation Flags</span>
            <div className="space-y-1.5">
              {report.flags.map((flag: any, fIdx: number) => {
                let badgeClass = "bg-gray-100 text-gray-600";
                if (flag.severity === "HIGH") badgeClass = "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200/30";
                else if (flag.severity === "MEDIUM") badgeClass = "bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-200/30";

                return (
                  <div key={fIdx} className="flex items-start gap-2 text-xs bg-gray-50/30 dark:bg-gray-950/10 p-2.5 rounded-lg border border-gray-100 dark:border-gray-850">
                    <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 ${badgeClass}`}>
                      {flag.severity}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300 font-semibold">{flag.issue}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const isVerifySubmitDisabled = loading || (
    actionType === "APPROVE" &&
    selectedNgo?.ai_verification_report?.recommendation === "LIKELY_FRAUD" &&
    (!overrideConfirmed || !adminNote.trim())
  );

  return (
    <div className="space-y-6">
      {ngos.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
          <span className="text-4xl mb-4 block">🎉</span>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">All caught up!</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            There are currently no pending NGO registration documents awaiting review.
          </p>
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
                {ngos.map((ngo) => (
                  <React.Fragment key={ngo.id}>
                    <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">{ngo.orgName}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{ngo.user.email}</div>
                        <div className="text-xs text-gray-400 mt-0.5">Founded: {ngo.foundedYear}</div>
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
                        <button
                          onClick={() => setExpandedNgoId(expandedNgoId === ngo.id ? null : ngo.id)}
                          className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold py-1.5 px-3 rounded-lg text-xs transition"
                        >
                          {expandedNgoId === ngo.id ? "Hide AI Check" : "AI Pre-Check"}
                        </button>
                        <button
                          onClick={() => openModal(ngo, "APPROVE")}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition"
                        >
                          Approve
                        </button>
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
                        <td colSpan={4} className="bg-gray-50/30 dark:bg-gray-950/10 px-8 py-5 border-b border-gray-200 dark:border-gray-800">
                          {renderAiPreCheckPanel(ngo)}
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
              {actionType === "APPROVE" && selectedNgo.ai_verification_report?.recommendation === "LIKELY_FRAUD" && (
                <div className="p-4 bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500 rounded text-xs text-red-800 dark:text-red-300 space-y-2">
                  <p className="font-extrabold flex items-center gap-1.5 text-red-750 dark:text-red-400">
                    ⚠️ AI LIKELY_FRAUD Override Warning
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
                  required={actionType === "REJECT" || (actionType === "APPROVE" && selectedNgo.ai_verification_report?.recommendation === "LIKELY_FRAUD")}
                  placeholder={
                    actionType === "REJECT"
                      ? "Specify why documents were rejected..."
                      : selectedNgo.ai_verification_report?.recommendation === "LIKELY_FRAUD"
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
