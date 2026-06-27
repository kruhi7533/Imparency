"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface Proof {
  id: string;
  milestoneId: string;
  submittedById: string;
  description: string;
  mediaUrls: string[];
  documentUrls: string[];
  aiValidationResult: string | null;
  aiValidationScore: number | null;
  submittedAt: string;
  submittedBy: {
    name: string;
    email: string;
  };
}

interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  targetAmount: number;
  deadline: string;
  status: string;
  sequenceOrder: number;
  createdAt: string;
  updatedAt: string;
  project: {
    id: string;
    ngoId: string;
    title: string;
    description: string;
    causeCategory: string;
    targetAmount: number;
    raisedAmount: number;
    coverImage: string;
    location: string;
    ngo: {
      id: string;
      orgName: string;
      registrationNumber: string;
      panNumber: string;
      address: string;
      ngoEmail: string;
    };
  };
  proofs: Proof[];
}

interface AuditRecord {
  id: string;
  action: string;
  note: string | null;
  aiScore: number | null;
  reviewedAt: string;
  admin: { name: string; email: string };
  milestone: {
    id: string;
    title: string;
    sequenceOrder: number;
    project: {
      title: string;
      ngo: { orgName: string };
    };
  };
}

interface ProofReviewClientProps {
  initialPending: Milestone[];
  initialAudit: AuditRecord[];
}

export default function ProofReviewClient({
  initialPending,
  initialAudit,
}: ProofReviewClientProps) {
  const router = useRouter();
  const [pendingList, setPendingList] = useState<Milestone[]>(initialPending);
  const [auditList, setAuditList] = useState<AuditRecord[]>(initialAudit);

  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [activeDoc, setActiveDoc] = useState<{ milestoneId: string; url: string; type: "image" | "pdf" } | null>(null);

  const getDocType = (url: string): "image" | "pdf" => {
    return url.toLowerCase().includes(".pdf") ? "pdf" : "image";
  };

  const toggleDoc = (milestoneId: string, url: string) => {
    if (activeDoc?.milestoneId === milestoneId && activeDoc?.url === url) {
      setActiveDoc(null);
    } else {
      setActiveDoc({ milestoneId, url, type: getDocType(url) });
    }
  };

  // Modal States
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [actionType, setActionType] = useState<"APPROVE" | "REJECT" | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Ask Question states
  const [askMilestone, setAskMilestone] = useState<Milestone | null>(null);
  const [question, setQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState("");
  const [askSuccess, setAskSuccess] = useState(false);

  const openModal = (milestone: Milestone, action: "APPROVE" | "REJECT") => {
    setSelectedMilestone(milestone);
    setActionType(action);
    setRejectionReason("");
    setError("");
  };

  const closeModal = () => {
    setSelectedMilestone(null);
    setActionType(null);
    setRejectionReason("");
    setError("");
  };

  const closeAskModal = () => {
    setAskMilestone(null);
    setQuestion("");
    setAskError("");
    setAskSuccess(false);
  };

  const handleSendQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askMilestone || !question.trim()) return;
    setAskLoading(true);
    setAskError("");
    setAskSuccess(false);
    try {
      const res = await fetch("/api/admin/ask-ngo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneId: askMilestone.id, question: question.trim() }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to send question");
      setAskSuccess(true);
      setQuestion("");
    } catch (err: any) {
      setAskError(err.message || "An unexpected error occurred");
    } finally {
      setAskLoading(false);
    }
  };

  const handleReviewAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMilestone || !actionType) return;

    if (actionType === "REJECT" && !rejectionReason.trim()) {
      setError("Please provide a rejection reason so the NGO knows how to improve their proof.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/review-proof", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          milestoneId: selectedMilestone.id,
          action: actionType,
          rejectionReason: actionType === "REJECT" ? rejectionReason.trim() : undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to submit review status");
      }

      // Update state
      setPendingList((prev) => prev.filter((m) => m.id !== selectedMilestone.id));
      // Optimistically add to audit trail
      const latestProof = selectedMilestone.proofs[0];
      setAuditList((prev) => [{
        id: Date.now().toString(),
        action: actionType === "APPROVE" ? "APPROVED" : "REJECTED",
        note: actionType === "REJECT" ? rejectionReason.trim() : null,
        aiScore: latestProof?.aiValidationScore ?? null,
        reviewedAt: new Date().toISOString(),
        admin: { name: "You", email: "" },
        milestone: {
          id: selectedMilestone.id,
          title: selectedMilestone.title,
          sequenceOrder: selectedMilestone.sequenceOrder,
          project: {
            title: selectedMilestone.project.title,
            ngo: { orgName: selectedMilestone.project.ngo.orgName }
          }
        }
      }, ...prev]);

      closeModal();
      router.refresh();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Parses the stringified AI validation JSON
  const parseAIResult = (resultStr: string | null) => {
    if (!resultStr) return null;
    try {
      return JSON.parse(resultStr);
    } catch (e) {
      return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Tabs Switcher */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setActiveTab("pending")}
          className={`py-2.5 px-6 font-bold text-sm transition-all border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === "pending"
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <span>Pending Reviews</span>
          {pendingList.length > 0 && (
            <span className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs px-2 py-0.5 rounded-full font-bold">
              {pendingList.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`py-2.5 px-6 font-bold text-sm transition-all border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === "history"
              ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <span>Audit Trail</span>
          <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-2 py-0.5 rounded-full font-bold">
            {auditList.length}
          </span>
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === "pending" ? (
        pendingList.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
            <span className="text-4xl mb-4 block">👍</span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">No pending reviews</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Awesome job! All milestone proof submissions have been verified and processed.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {pendingList.map((milestone) => {
              const latestProof = milestone.proofs[0];
              const aiDetails = parseAIResult(latestProof?.aiValidationResult);

              return (
                <div
                  key={milestone.id}
                  className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm flex flex-col lg:flex-row gap-6 hover:shadow-md transition duration-200"
                >
                  {/* Left Side: Milestone and Campaign details */}
                  <div className={`space-y-4 ${activeDoc?.milestoneId === milestone.id ? "lg:w-64 shrink-0" : "flex-1"}`}>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                          Milestone #{milestone.sequenceOrder}
                        </span>
                        <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-600 dark:text-yellow-400 rounded">
                          Awaiting Manual Override
                        </span>
                      </div>
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        {milestone.title}
                      </h2>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1.5 flex-wrap">
                        Campaign: <strong className="font-semibold text-gray-700 dark:text-gray-300">{milestone.project.title}</strong>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        NGO: <strong className="font-semibold text-gray-700 dark:text-gray-300">{milestone.project.ngo.orgName}</strong>
                        <a
                          href={`/admin/risk-compliance`}
                          className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline underline-offset-2"
                          title="View risk & compliance for this NGO"
                        >
                          Risk & Compliance →
                        </a>
                      </p>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-800/30 p-3 rounded-lg border border-gray-100 dark:border-gray-800/50">
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                        Expected Scope
                      </h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                        {milestone.description}
                      </p>
                      <div className="mt-2 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-4">
                        <span>Budget: ₹{milestone.targetAmount.toLocaleString("en-IN")}</span>
                        <span>Deadline: {new Date(milestone.deadline).toLocaleDateString()}</span>
                      </div>
                    </div>

                    {latestProof && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          NGO Completion Statement
                        </h4>
                        <p className="text-xs text-gray-600 dark:text-gray-400 bg-emerald-50/20 dark:bg-emerald-950/10 p-3 rounded-lg border border-emerald-100/50 dark:border-emerald-900/10 leading-relaxed">
                          {latestProof.description}
                        </p>

                        {/* Attachments */}
                        {(latestProof.mediaUrls.length > 0 || latestProof.documentUrls.length > 0) && (
                          <div className="space-y-1">
                            <h5 className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                              Attached Evidence:
                            </h5>
                            <div className="flex flex-wrap gap-2">
                              {latestProof.mediaUrls.map((url, index) => {
                                const isActive = activeDoc?.milestoneId === milestone.id && activeDoc?.url === url;
                                return (
                                  <button
                                    key={url}
                                    onClick={() => toggleDoc(milestone.id, url)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-1 transition ${
                                      isActive
                                        ? "bg-emerald-600 text-white border-emerald-600"
                                        : "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-100/50 dark:border-emerald-900/20"
                                    }`}
                                  >
                                    🖼️ Image {index + 1}
                                    {isActive && <span className="ml-1 opacity-70">✕</span>}
                                  </button>
                                );
                              })}
                              {latestProof.documentUrls.map((url, index) => {
                                const isActive = activeDoc?.milestoneId === milestone.id && activeDoc?.url === url;
                                return (
                                  <button
                                    key={url}
                                    onClick={() => toggleDoc(milestone.id, url)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-1 transition ${
                                      isActive
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/20 dark:hover:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-100/50 dark:border-blue-900/20"
                                    }`}
                                  >
                                    📄 Document {index + 1}
                                    {isActive && <span className="ml-1 opacity-70">✕</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Center: Inline Document Viewer */}
                  {activeDoc?.milestoneId === milestone.id && (
                    <div className="flex-1 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 pt-6 lg:pt-0 lg:pl-6 flex flex-col gap-3 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          Document Preview
                        </h3>
                        <button
                          onClick={() => setActiveDoc(null)}
                          className="text-[10px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
                        >
                          Close ✕
                        </button>
                      </div>
                      <div className="flex-1 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 min-h-[420px]">
                        {activeDoc.type === "image" ? (
                          <img
                            src={activeDoc.url}
                            alt="Evidence"
                            className="w-full h-full object-contain max-h-[520px]"
                          />
                        ) : (
                          <iframe
                            src={activeDoc.url}
                            title="Document Preview"
                            className="w-full h-full min-h-[520px] border-0"
                          />
                        )}
                      </div>
                      <a
                        href={activeDoc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-center transition"
                      >
                        Open in new tab ↗
                      </a>
                    </div>
                  )}

                  {/* Right Side: AI Audit and Action triggers */}
                  <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 pt-6 lg:pt-0 lg:pl-6 flex flex-col justify-between">
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Gemini AI Audit Report
                      </h3>

                      {latestProof && latestProof.aiValidationScore !== null ? (
                        <div className="space-y-6">
                          <div className="space-y-3">
                            {/* Score Badge */}
                            <div className="flex items-center gap-3">
                              <span
                                className={`text-2xl font-black px-4 py-1.5 rounded-2xl ${
                                  latestProof.aiValidationScore >= 70
                                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400"
                                    : latestProof.aiValidationScore >= 50
                                    ? "bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-400"
                                    : "bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-400"
                                }`}
                              >
                                {latestProof.aiValidationScore}
                              </span>
                              <div>
                                <div className="text-xs font-bold text-gray-900 dark:text-white">
                                  Milestone Completion Score
                                </div>
                                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                  threshold: 70+ for auto-completion
                                </div>
                              </div>
                            </div>

                            {/* Reasoning */}
                            {aiDetails && (
                              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-2">
                                <p className="leading-relaxed">
                                  <strong className="font-semibold text-gray-700 dark:text-gray-300">Reasoning:</strong>{" "}
                                  {aiDetails.reasoning}
                                </p>

                                {/* Flags */}
                                {aiDetails.flags && aiDetails.flags.length > 0 && (
                                  <div className="space-y-1">
                                    <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider block">
                                      Flags Detected:
                                    </span>
                                    <ul className="list-disc pl-4 space-y-0.5 text-red-600 dark:text-red-400">
                                      {aiDetails.flags.map((flag: string, idx: number) => (
                                        <li key={idx} className="text-[11px] leading-tight">
                                          {flag}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Suggestion */}
                                {aiDetails.suggestion && (
                                  <p className="text-[11px] bg-yellow-50 dark:bg-yellow-950/10 text-yellow-700 dark:text-yellow-400 p-2 rounded border border-yellow-100/30 dark:border-yellow-900/20 italic">
                                    Suggestion: {aiDetails.suggestion}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Theory of Change Alignment Card */}
                          {aiDetails && typeof aiDetails.tocAlignmentScore === "number" && (
                            <div className="bg-blue-50/50 dark:bg-blue-950/10 p-4 rounded-xl border border-blue-100/50 dark:border-blue-900/20 space-y-3">
                              <h3 className="text-[11px] font-bold text-blue-800 dark:text-blue-400 uppercase tracking-wider flex items-center justify-between">
                                Theory of Change Alignment
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  aiDetails.tocAlignmentScore >= 70 ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {aiDetails.tocAlignmentScore}%
                                </span>
                              </h3>
                              
                              <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed italic">
                                {aiDetails.tocReasoning}
                              </p>

                              {aiDetails.tocStrengths && aiDetails.tocStrengths.length > 0 && (
                                <div className="space-y-1 mt-2">
                                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Strengths:</span>
                                  <ul className="list-disc pl-4 space-y-0.5 text-emerald-700 dark:text-emerald-500">
                                    {aiDetails.tocStrengths.map((str: string, idx: number) => (
                                      <li key={idx} className="text-[10px]">{str}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {aiDetails.tocGaps && aiDetails.tocGaps.length > 0 && (
                                <div className="space-y-1 mt-2 bg-yellow-50/50 p-2 rounded border border-yellow-100">
                                  <span className="text-[10px] font-bold text-yellow-700 uppercase">Warning - Impact Gaps:</span>
                                  <ul className="list-disc pl-4 space-y-0.5 text-yellow-800">
                                    {aiDetails.tocGaps.map((gap: string, idx: number) => (
                                      <li key={idx} className="text-[10px]">{gap}</li>
                                    ))}
                                  </ul>
                                  <p className="text-[9px] text-yellow-600 mt-1 italic leading-tight">
                                    The milestone was completed, but there is insufficient evidence that it contributes toward the project's stated expected outcome.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No AI assessment data recorded.</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 pt-6 border-t border-gray-100 dark:border-gray-800 mt-6 lg:mt-0">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openModal(milestone, "APPROVE")}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs transition text-center"
                        >
                          Approve Proof
                        </button>
                        <button
                          onClick={() => openModal(milestone, "REJECT")}
                          className="flex-1 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 text-red-600 dark:text-red-400 font-bold py-2 rounded-xl text-xs transition text-center"
                        >
                          Reject Proof
                        </button>
                      </div>
                      <button
                        onClick={() => { setAskMilestone(milestone); setAskSuccess(false); }}
                        className="w-full bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-bold py-2 rounded-xl text-xs transition border border-amber-100/50 dark:border-amber-900/20"
                      >
                        Ask NGO a Question
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Audit Trail tab */
        auditList.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
            <span className="text-4xl mb-4 block">📋</span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">No decisions recorded yet</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Every approval and rejection will appear here with the admin name, timestamp, AI score, and reason.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Decision</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Milestone & Campaign</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Reviewed By</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI Score at Review</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Note / Reason</th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Reviewed At</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                  {auditList.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full ${
                          record.action === "APPROVED"
                            ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                            : "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400"
                        }`}>
                          {record.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <div className="text-xs font-bold text-gray-900 dark:text-white truncate" title={record.milestone.title}>
                          #{record.milestone.sequenceOrder} — {record.milestone.title}
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {record.milestone.project.title}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {record.milestone.project.ngo.orgName}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-xs font-bold text-gray-900 dark:text-white">{record.admin.name}</div>
                        <div className="text-[10px] text-gray-400">{record.admin.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {record.aiScore !== null ? (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            record.aiScore >= 70
                              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                              : record.aiScore >= 50
                              ? "bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400"
                              : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
                          }`}>
                            {record.aiScore}/100
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        {record.note ? (
                          <p className="text-xs text-gray-600 dark:text-gray-400 italic line-clamp-2" title={record.note}>
                            "{record.note}"
                          </p>
                        ) : (
                          <span className="text-xs text-gray-400 italic">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-xs text-gray-500 dark:text-gray-400">
                        {new Date(record.reviewedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Ask NGO Question Modal */}
      {askMilestone && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 dark:border-gray-800">
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-1">
              Ask NGO a Question
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Sending to <span className="font-semibold text-gray-700 dark:text-gray-300">{askMilestone.project.ngo.orgName}</span> regarding milestone <span className="font-semibold text-gray-700 dark:text-gray-300">"{askMilestone.title}"</span>. This does not reject the proof — it stays under review.
            </p>

            {askError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 rounded">
                {askError}
              </div>
            )}

            {askSuccess ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-xl text-sm font-semibold text-center">
                  Question sent to {askMilestone.project.ngo.orgName} successfully.
                </div>
                <button
                  onClick={closeAskModal}
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendQuestion} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Your Question *
                  </label>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    rows={4}
                    required
                    placeholder="e.g. Could you provide a clearer photo of the completed structure? The current image does not show the full extent of the work..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 transition resize-none"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeAskModal}
                    disabled={askLoading}
                    className="px-4 py-2 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={askLoading}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                  >
                    {askLoading && <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />}
                    Send Question
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {selectedMilestone && actionType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 dark:border-gray-800">
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-2">
              {actionType === "APPROVE" ? "Approve Milestone Proof" : "Reject Milestone Proof"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {actionType === "APPROVE"
                ? `Confirming completion approval for milestone "${selectedMilestone.title}". This will mark the milestone as completed, batch-generate impact narratives, and notify all campaign donors.`
                : `Specify the rejection reason for milestone "${selectedMilestone.title}". This will reset the milestone to IN_PROGRESS so the NGO can resubmit proof.`}
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 rounded">
                {error}
              </div>
            )}

            <form onSubmit={handleReviewAction} className="space-y-4">
              {actionType === "REJECT" && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Rejection Reason *
                  </label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    rows={4}
                    required
                    placeholder="Provide detailed reasons explaining what details or evidence are lacking..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
                  />
                </div>
              )}

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
                  disabled={loading}
                  className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                    actionType === "APPROVE"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
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
