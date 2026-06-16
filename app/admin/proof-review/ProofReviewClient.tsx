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
    };
  };
  proofs: Proof[];
}

interface ProofReviewClientProps {
  initialPending: Milestone[];
  initialHistory: Milestone[];
}

export default function ProofReviewClient({
  initialPending,
  initialHistory,
}: ProofReviewClientProps) {
  const router = useRouter();
  const [pendingList, setPendingList] = useState<Milestone[]>(initialPending);
  const [historyList, setHistoryList] = useState<Milestone[]>(initialHistory);

  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");

  // Modal States
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [actionType, setActionType] = useState<"APPROVE" | "REJECT" | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      if (actionType === "APPROVE") {
        // Remove from pending
        setPendingList((prev) => prev.filter((m) => m.id !== selectedMilestone.id));
        // Add to history (local mock update)
        const approvedMilestone = {
          ...selectedMilestone,
          status: "COMPLETED",
        };
        setHistoryList((prev) => [approvedMilestone, ...prev]);
      } else {
        // Reject resets milestone to IN_PROGRESS, remove from pending
        setPendingList((prev) => prev.filter((m) => m.id !== selectedMilestone.id));
      }

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
          <span>Audit History</span>
          <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-2 py-0.5 rounded-full font-bold">
            {historyList.length}
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
                  <div className="flex-1 space-y-4">
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
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Campaign: <strong className="font-semibold text-gray-700 dark:text-gray-300">{milestone.project.title}</strong> | NGO: <strong className="font-semibold text-gray-700 dark:text-gray-300">{milestone.project.ngo.orgName}</strong>
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
                              {latestProof.mediaUrls.map((url, index) => (
                                <a
                                  key={url}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold px-3 py-1.5 rounded-lg border border-emerald-100/50 dark:border-emerald-900/20 flex items-center gap-1 transition"
                                >
                                  🖼️ Image {index + 1}
                                </a>
                              ))}
                              {latestProof.documentUrls.map((url, index) => (
                                <a
                                  key={url}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/20 dark:hover:bg-blue-950/40 text-blue-700 dark:text-blue-400 font-bold px-3 py-1.5 rounded-lg border border-blue-100/50 dark:border-blue-900/20 flex items-center gap-1 transition"
                                >
                                  📄 Document {index + 1} (PDF)
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right Side: AI Audit and Action triggers */}
                  <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 pt-6 lg:pt-0 lg:pl-6 flex flex-col justify-between">
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Gemini AI Audit Report
                      </h3>

                      {latestProof && latestProof.aiValidationScore !== null ? (
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
                                AI Confidence Score
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
                      ) : (
                        <p className="text-xs text-gray-400 italic">No AI assessment data recorded.</p>
                      )}
                    </div>

                    <div className="flex gap-2 pt-6 border-t border-gray-100 dark:border-gray-800 mt-6 lg:mt-0">
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
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* History tab content */
        historyList.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
            <span className="text-4xl mb-4 block">📂</span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">History is empty</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No milestones have been completed and audited yet.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Milestone & Project</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">NGO Statement & Files</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI Audit</th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                  {historyList.map((milestone) => {
                    const latestProof = milestone.proofs[0];
                    return (
                      <tr key={milestone.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition">
                        <td className="px-6 py-4 max-w-xs">
                          <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            Milestone #{milestone.sequenceOrder}
                          </div>
                          <div className="text-sm font-bold text-gray-900 dark:text-white truncate" title={milestone.title}>
                            {milestone.title}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate" title={milestone.project.title}>
                            Campaign: {milestone.project.title}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            NGO: {milestone.project.ngo.orgName}
                          </div>
                        </td>
                        <td className="px-6 py-4 max-w-md">
                          {latestProof ? (
                            <>
                              <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2" title={latestProof.description}>
                                {latestProof.description}
                              </p>
                              <div className="flex flex-wrap gap-2 mt-2">
                                {latestProof.mediaUrls.map((url, idx) => (
                                  <a
                                    key={url}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 font-bold underline"
                                  >
                                    Image {idx + 1}
                                  </a>
                                ))}
                                {latestProof.documentUrls.map((url, idx) => (
                                  <a
                                    key={url}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-bold underline"
                                  >
                                    Doc {idx + 1} (PDF)
                                  </a>
                                ))}
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-gray-400 italic">No proof files submitted</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {latestProof && latestProof.aiValidationScore !== null ? (
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-sm font-bold px-2 py-0.5 rounded ${
                                  latestProof.aiValidationScore >= 70
                                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                                    : "bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400"
                                }`}
                              >
                                AI Score: {latestProof.aiValidationScore}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 italic">No data</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-xs px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full font-bold">
                            {milestone.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
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
