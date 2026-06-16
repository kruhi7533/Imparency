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
  
  // Modal states
  const [selectedNgo, setSelectedNgo] = useState<NGO | null>(null);
  const [actionType, setActionType] = useState<"APPROVE" | "REJECT" | null>(null);
  const [adminNote, setAdminNote] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const openModal = (ngo: NGO, type: "APPROVE" | "REJECT") => {
    setSelectedNgo(ngo);
    setActionType(type);
    setAdminNote(type === "APPROVE" ? "All documents verified successfully." : "");
    setError("");
  };

  const closeModal = () => {
    setSelectedNgo(null);
    setActionType(null);
    setAdminNote("");
    setError("");
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
                  <tr key={ngo.id}>
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
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Administrator Note *
                </label>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={4}
                  required={actionType === "REJECT"}
                  placeholder={actionType === "REJECT" ? "Specify why documents were rejected..." : "Add verification notes..."}
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
