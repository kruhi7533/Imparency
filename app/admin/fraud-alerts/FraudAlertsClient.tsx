"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface FraudAlert {
  id: string;
  type: string;
  entityId: string;
  entityType: string;
  description: string;
  severity: string;
  alertCategory: string;
  subType: string | null;
  resolved: boolean;
  resolutionNote: string | null;
  createdAt: string;
}

interface FraudAlertsClientProps {
  initialDocErrors: FraudAlert[];
  initialFraudAlerts: FraudAlert[];
  initialResolved: FraudAlert[];
}

type ActiveTab = "fraud" | "doc_errors" | "history";

export default function FraudAlertsClient({
  initialDocErrors,
  initialFraudAlerts,
  initialResolved,
}: FraudAlertsClientProps) {
  const router = useRouter();
  const [docErrors, setDocErrors] = useState<FraudAlert[]>(initialDocErrors);
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlert[]>(initialFraudAlerts);
  const [resolved, setResolved] = useState<FraudAlert[]>(initialResolved);

  const [activeTab, setActiveTab] = useState<ActiveTab>("fraud");

  // Modal states
  const [selectedAlert, setSelectedAlert] = useState<FraudAlert | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const openResolveModal = (alert: FraudAlert) => {
    setSelectedAlert(alert);
    setResolutionNote("");
    setError("");
  };

  const closeResolveModal = () => {
    setSelectedAlert(null);
    setResolutionNote("");
    setError("");
  };

  const handleResolveAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlert) return;

    if (!resolutionNote.trim()) {
      setError("Please supply a resolution note detailing the actions taken.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/resolve-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alertId: selectedAlert.id,
          resolutionNote: resolutionNote.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to resolve alert");

      const resolvedAlert: FraudAlert = { ...selectedAlert, resolved: true, resolutionNote: resolutionNote.trim() };

      if (selectedAlert.alertCategory === "DOCUMENT_ERROR") {
        setDocErrors(prev => prev.filter(a => a.id !== selectedAlert.id));
      } else {
        setFraudAlerts(prev => prev.filter(a => a.id !== selectedAlert.id));
      }
      setResolved(prev => [resolvedAlert, ...prev]);

      closeResolveModal();
      router.refresh();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const getSeverityBadgeClass = (severity: string) => {
    switch (severity) {
      case "HIGH": return "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900/30";
      case "MEDIUM": return "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400 border-yellow-100 dark:border-yellow-900/30";
      default: return "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-900/30";
    }
  };

  const renderAlertTable = (alerts: FraudAlert[], emptyTitle: string, emptyBody: string, emptyIcon: string) => {
    if (alerts.length === 0) {
      return (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
          <span className="text-4xl mb-4 block">{emptyIcon}</span>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{emptyTitle}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{emptyBody}</p>
        </div>
      );
    }

    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Severity</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Alert Type</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Details</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Detected At</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
              {alerts.map((alert) => (
                <tr key={alert.id} className="hover:bg-gray-50/30 dark:hover:bg-gray-800/10 transition">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 border rounded-full ${getSeverityBadgeClass(alert.severity)}`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                      {alert.type.replace(/_/g, " ")}
                    </span>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {alert.entityType}: {alert.entityId.substring(0, 8)}...
                    </div>
                  </td>
                  <td className="px-6 py-4 max-w-sm">
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{alert.description}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                    {new Date(alert.createdAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => openResolveModal(alert)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition"
                    >
                      Resolve Alert
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setActiveTab("fraud")}
          className={`py-2.5 px-6 font-bold text-sm transition-all border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === "fraud"
              ? "border-red-500 text-red-600 dark:text-red-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <span>Fraud Alerts</span>
          {fraudAlerts.length > 0 && (
            <span className="bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs px-2 py-0.5 rounded-full font-bold">
              {fraudAlerts.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("doc_errors")}
          className={`py-2.5 px-6 font-bold text-sm transition-all border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === "doc_errors"
              ? "border-amber-500 text-amber-600 dark:text-amber-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          <span>Document Errors</span>
          {docErrors.length > 0 && (
            <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-xs px-2 py-0.5 rounded-full font-bold">
              {docErrors.length}
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
          <span>Resolution History</span>
          <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-2 py-0.5 rounded-full font-bold">
            {resolved.length}
          </span>
        </button>
      </div>

      {/* Tab descriptions */}
      {activeTab === "fraud" && (
        <div className="flex items-start gap-3 px-1">
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 shrink-0">
            <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Suspected fraudulent activity</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Duplicate identities, PAN mismatches, tampered documents, payment abuse. These require investigation — the NGO may be deliberately misrepresenting itself.
            </p>
          </div>
        </div>
      )}

      {activeTab === "doc_errors" && (
        <div className="flex items-start gap-3 px-1">
          <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 shrink-0">
            <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Fixable document issues</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Missing 80G copy, wrong file uploaded, expired certificates, unreadable scans. The NGO can resolve these by resubmitting correct documents.
            </p>
          </div>
        </div>
      )}

      {/* Tab Contents */}
      {activeTab === "fraud" && renderAlertTable(
        fraudAlerts,
        "No active fraud alerts",
        "No suspicious behaviors detected. Fraud indicators include duplicate identities, PAN mismatches, and tampered documents.",
        "🛡️"
      )}

      {activeTab === "doc_errors" && renderAlertTable(
        docErrors,
        "No document errors",
        "All NGO submissions have complete and valid documents.",
        "📄"
      )}

      {activeTab === "history" && (
        resolved.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
            <span className="text-4xl mb-4 block">📂</span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">No resolved history</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">No alerts have been resolved yet.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Severity</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Alert Type</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Resolution Notes</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Resolved At</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                  {resolved.map((alert) => (
                    <tr key={alert.id} className="hover:bg-gray-50/20 dark:hover:bg-gray-800/5 transition">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-[10px] font-extrabold px-2 py-0.5 border rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          {alert.severity}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                          {alert.type.replace(/_/g, " ")}
                        </span>
                        <div className="text-[10px] text-gray-400">{alert.entityType}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          alert.alertCategory === "DOCUMENT_ERROR"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                            : "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                        }`}>
                          {alert.alertCategory === "DOCUMENT_ERROR" ? "Doc Error" : "Fraud"}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-sm">
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">"{alert.resolutionNote}"</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {new Date(alert.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Resolve Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 dark:border-gray-800">
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-1">
              Resolve {selectedAlert.alertCategory === "DOCUMENT_ERROR" ? "Document Error" : "Fraud Alert"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {selectedAlert.alertCategory === "DOCUMENT_ERROR"
                ? "Mark this document issue as resolved once the NGO has resubmitted correct documents."
                : "Document your investigation findings and actions taken before marking this resolved."}
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 rounded">
                {error}
              </div>
            )}

            <form onSubmit={handleResolveAlert} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Resolution Audit Note *
                </label>
                <textarea
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  rows={4}
                  required
                  placeholder={
                    selectedAlert.alertCategory === "DOCUMENT_ERROR"
                      ? "e.g. NGO resubmitted correct 80G document — verified and approved."
                      : "e.g. Verified PAN manually, confirmed legitimate. Different branch name used."
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeResolveModal}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                >
                  {loading && <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>}
                  Confirm Resolve
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
