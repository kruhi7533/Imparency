"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { NGOComplianceSummary } from "@/lib/compliance-agent";

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

interface RiskReview {
  id: string;
  ngoId: string;
  ngo: { orgName: string };
  riskLevel: string;
  status: string;
  findings: any;
  reviewNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface Props {
  initialFraudAlerts: FraudAlert[];
  initialDocErrors: FraudAlert[];
  initialResolved: FraudAlert[];
  initialRiskReviews: RiskReview[];
  complianceSummaries: NGOComplianceSummary[];
}

type MainTab = "risk" | "compliance";
type RiskSubTab = "fraud" | "doc_errors" | "reviews" | "history";

const SEVERITY_BADGE: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30",
  LOW: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30",
  CRITICAL: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300",
};

const FCRA_BADGE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  EXPIRING_SOON: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  EXPIRED: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  PENDING: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  REJECTED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  NONE: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

export default function RiskComplianceClient({
  initialFraudAlerts,
  initialDocErrors,
  initialResolved,
  initialRiskReviews,
  complianceSummaries,
}: Props) {
  const router = useRouter();
  const [mainTab, setMainTab] = useState<MainTab>("risk");
  const [riskSubTab, setRiskSubTab] = useState<RiskSubTab>("fraud");

  const [fraudAlerts, setFraudAlerts] = useState(initialFraudAlerts);
  const [docErrors, setDocErrors] = useState(initialDocErrors);
  const [resolved, setResolved] = useState(initialResolved);
  const [riskReviews, setRiskReviews] = useState(initialRiskReviews);

  // Resolve alert modal
  const [selectedAlert, setSelectedAlert] = useState<FraudAlert | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [alertLoading, setAlertLoading] = useState(false);
  const [alertError, setAlertError] = useState("");

  // Risk review modal
  const [selectedReview, setSelectedReview] = useState<RiskReview | null>(null);
  const [reviewAction, setReviewAction] = useState<"CLEAR" | "SUSPEND" | "ESCALATE" | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");

  // Compliance filter
  const [complianceSearch, setComplianceSearch] = useState("");

  const handleResolveAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlert || !resolutionNote.trim()) {
      setAlertError("A resolution note is required.");
      return;
    }
    setAlertLoading(true);
    setAlertError("");
    try {
      const res = await fetch("/api/admin/resolve-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId: selectedAlert.id, resolutionNote: resolutionNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const resolvedAlert = { ...selectedAlert, resolved: true, resolutionNote: resolutionNote.trim() };
      if (selectedAlert.alertCategory === "DOCUMENT_ERROR") {
        setDocErrors(prev => prev.filter(a => a.id !== selectedAlert.id));
      } else {
        setFraudAlerts(prev => prev.filter(a => a.id !== selectedAlert.id));
      }
      setResolved(prev => [resolvedAlert, ...prev]);
      setSelectedAlert(null);
      setResolutionNote("");
      router.refresh();
    } catch (err: any) {
      setAlertError(err.message);
    } finally {
      setAlertLoading(false);
    }
  };

  const handleRiskReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReview || !reviewAction || !reviewNote.trim()) {
      setReviewError("A review note is required before taking action.");
      return;
    }
    setReviewLoading(true);
    setReviewError("");
    try {
      const res = await fetch("/api/admin/risk/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: selectedReview.id, action: reviewAction, reviewNote: reviewNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setRiskReviews(prev => prev.filter(r => r.id !== selectedReview.id));
      setSelectedReview(null);
      setReviewAction(null);
      setReviewNote("");
      router.refresh();
    } catch (err: any) {
      setReviewError(err.message);
    } finally {
      setReviewLoading(false);
    }
  };

  const filteredCompliance = complianceSummaries.filter(s =>
    s.orgName.toLowerCase().includes(complianceSearch.toLowerCase()) ||
    s.email.toLowerCase().includes(complianceSearch.toLowerCase())
  );

  const renderAlertTable = (alerts: FraudAlert[], emptyMsg: string, emptyIcon: string) => {
    if (alerts.length === 0) {
      return (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-10 text-center shadow-sm">
          <span className="text-4xl mb-3 block">{emptyIcon}</span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">{emptyMsg}</p>
        </div>
      );
    }
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {["Severity", "Alert Type", "Details", "Detected", ""].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {alerts.map(alert => (
                <tr key={alert.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition">
                  <td className="px-5 py-4">
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 border rounded-full ${SEVERITY_BADGE[alert.severity] || SEVERITY_BADGE.LOW}`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wide">{alert.type.replace(/_/g, " ")}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{alert.entityType} · {alert.entityId.substring(0, 8)}…</p>
                  </td>
                  <td className="px-5 py-4 max-w-sm">
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{alert.description}</p>
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(alert.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={() => { setSelectedAlert(alert); setResolutionNote(""); setAlertError(""); }}
                      className="bg-slate-700 hover:bg-slate-800 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition"
                    >
                      Resolve
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
      {/* Main tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
        {(["risk", "compliance"] as MainTab[]).map(t => (
          <button
            key={t}
            onClick={() => setMainTab(t)}
            className={`px-5 py-2 text-xs font-bold rounded-lg transition capitalize ${mainTab === t ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}
          >
            {t === "risk" ? "Risk Agent" : "Compliance Agent"}
          </button>
        ))}
      </div>

      {/* ── RISK TAB ── */}
      {mainTab === "risk" && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 rounded-xl">
            <div className="text-amber-600 dark:text-amber-400 mt-0.5">⚠</div>
            <div>
              <p className="text-sm font-bold text-amber-900 dark:text-amber-300">Risk Agent — Behavioral & Fraud Signals</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                Monitors suspicious patterns. Admin decides all outcomes — no auto-suspension.
              </p>
            </div>
          </div>

          {/* Risk sub-tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-800">
            {([
              { key: "fraud", label: "Fraud Alerts", count: fraudAlerts.length, color: "border-red-400 text-red-600 dark:text-red-400" },
              { key: "doc_errors", label: "Document Errors", count: docErrors.length, color: "border-amber-400 text-amber-600 dark:text-amber-400" },
              { key: "reviews", label: "Risk Reviews", count: riskReviews.length, color: "border-blue-400 text-blue-600 dark:text-blue-400" },
              { key: "history", label: "History", count: resolved.length, color: "border-emerald-500 text-emerald-600 dark:text-emerald-400" },
            ] as { key: RiskSubTab; label: string; count: number; color: string }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setRiskSubTab(t.key)}
                className={`py-2.5 px-5 font-bold text-sm border-b-2 -mb-px flex items-center gap-2 transition-all ${riskSubTab === t.key ? t.color : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-1.5 py-0.5 rounded-full font-bold">{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {riskSubTab === "fraud" && renderAlertTable(fraudAlerts, "No active fraud alerts", "🛡️")}
          {riskSubTab === "doc_errors" && renderAlertTable(docErrors, "No document errors", "📄")}

          {riskSubTab === "reviews" && (
            riskReviews.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-10 text-center shadow-sm">
                <span className="text-4xl mb-3 block">🔍</span>
                <p className="text-sm font-bold text-gray-900 dark:text-white">No open risk reviews</p>
                <p className="text-xs text-gray-500 mt-1">Risk reviews are created when consecutive low proof scores are detected.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {riskReviews.map(r => (
                  <div key={r.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-black text-gray-900 dark:text-white">{r.ngo.orgName}</p>
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 border rounded-full ${SEVERITY_BADGE[r.riskLevel] || SEVERITY_BADGE.LOW}`}>
                            {r.riskLevel}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 rounded-full">
                            {r.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {r.findings?.reason?.replace(/_/g, " ")} · Opened {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                        {r.findings?.recommendedAction && (
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 font-semibold">
                            Recommended: {r.findings.recommendedAction.replace(/_/g, " ")}
                          </p>
                        )}
                        <a
                          href="/admin/proof-review"
                          className="inline-block text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline underline-offset-2 mt-1"
                        >
                          View Proofs →
                        </a>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {(["CLEAR", "SUSPEND", "ESCALATE"] as const).map(a => (
                          <button
                            key={a}
                            onClick={() => { setSelectedReview(r); setReviewAction(a); setReviewNote(""); setReviewError(""); }}
                            className={`text-xs font-bold py-1.5 px-3 rounded-lg transition ${
                              a === "SUSPEND" ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/20 dark:text-red-400"
                              : a === "CLEAR" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400"
                              : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/20 dark:text-amber-400"
                            }`}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {riskSubTab === "history" && (
            resolved.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-10 text-center shadow-sm">
                <span className="text-4xl mb-3 block">📂</span>
                <p className="text-sm font-bold text-gray-900 dark:text-white">No resolved alerts yet</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
                    <thead className="bg-gray-50 dark:bg-gray-800/50">
                      <tr>
                        {["Severity", "Type", "Category", "Resolution Note", "Date"].map(h => (
                          <th key={h} className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {resolved.map(a => (
                        <tr key={a.id} className="hover:bg-slate-50/30 dark:hover:bg-slate-800/10 transition">
                          <td className="px-5 py-4">
                            <span className="text-[10px] font-extrabold px-2 py-0.5 border rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{a.severity}</span>
                          </td>
                          <td className="px-5 py-4 text-xs font-bold text-gray-900 dark:text-white uppercase">{a.type.replace(/_/g, " ")}</td>
                          <td className="px-5 py-4">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.alertCategory === "DOCUMENT_ERROR" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                              {a.alertCategory === "DOCUMENT_ERROR" ? "Doc Error" : "Fraud"}
                            </span>
                          </td>
                          <td className="px-5 py-4 max-w-xs"><p className="text-xs text-gray-500 italic">"{a.resolutionNote}"</p></td>
                          <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">{new Date(a.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ── COMPLIANCE TAB ── */}
      {mainTab === "compliance" && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-xl">
            <div className="text-blue-600 dark:text-blue-400 mt-0.5">✓</div>
            <div>
              <p className="text-sm font-bold text-blue-900 dark:text-blue-300">Compliance Agent — KYC & Regulatory Status</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                Tracks document verification, FCRA registration, and compliance scores. Read-only — actions go through NGO Verification or FCRA Review.
              </p>
            </div>
          </div>

          <input
            type="text"
            placeholder="Search by NGO name or email…"
            value={complianceSearch}
            onChange={e => setComplianceSearch(e.target.value)}
            className="w-full max-w-sm px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          {filteredCompliance.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-10 text-center shadow-sm">
              <p className="text-sm font-bold text-gray-900 dark:text-white">No NGOs found</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      {["Organisation", "Score", "PAN", "Reg", "80G", "12A", "FCRA"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredCompliance.map(s => {
                      const needsAction = s.fcraBadge === "EXPIRING_SOON" || s.fcraBadge === "EXPIRED";
                      const isExpired = s.fcraBadge === "EXPIRED";

                      let fcraUrgencyLabel = "";
                      if (s.fcraExpiryDate) {
                        const diffDays = Math.ceil(
                          (new Date(s.fcraExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                        );
                        if (isExpired) {
                          fcraUrgencyLabel = `Expired ${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? "s" : ""} ago`;
                        } else if (s.fcraBadge === "EXPIRING_SOON") {
                          fcraUrgencyLabel = `${diffDays} day${diffDays !== 1 ? "s" : ""} left`;
                        }
                      }

                      return (
                        <tr
                          key={s.ngoId}
                          className={`transition ${
                            isExpired
                              ? "bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50/60"
                              : needsAction
                              ? "bg-amber-50/40 dark:bg-amber-950/10 hover:bg-amber-50/60"
                              : "hover:bg-slate-50/40 dark:hover:bg-slate-800/10"
                          }`}
                        >
                          <td className="px-5 py-4">
                            <p className="text-xs font-bold text-gray-900 dark:text-white">{s.orgName}</p>
                            <p className="text-[10px] text-gray-400">{s.email}</p>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`text-sm font-black ${s.complianceScore >= 80 ? "text-emerald-600" : s.complianceScore >= 50 ? "text-amber-600" : "text-red-500"}`}>
                              {s.complianceScore}
                            </span>
                            <span className="text-[10px] text-gray-400">/100</span>
                            <a
                              href="/admin/proof-review"
                              className="block text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline underline-offset-2 mt-0.5"
                            >
                              Proofs →
                            </a>
                          </td>
                          {[s.panVerified, s.registrationVerified, s.eightyGVerified, s.a12Verified].map((v, i) => (
                            <td key={i} className="px-5 py-4 text-center">
                              <span className={`text-sm font-black ${v ? "text-emerald-600" : "text-gray-300 dark:text-gray-600"}`}>{v ? "✓" : "—"}</span>
                            </td>
                          ))}
                          <td className="px-5 py-4">
                            <div className="flex flex-col gap-1.5 items-start">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${FCRA_BADGE[s.fcraBadge] || FCRA_BADGE.NONE}`}>
                                {s.fcraBadge.replace(/_/g, " ")}
                              </span>
                              {fcraUrgencyLabel && (
                                <span className={`text-[10px] font-extrabold ${isExpired ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                                  {fcraUrgencyLabel}
                                </span>
                              )}
                              {needsAction && (
                                <a
                                  href="/admin/fcra-review"
                                  className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-1 rounded-lg transition ${
                                    isExpired
                                      ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                                      : "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-950/50"
                                  }`}
                                >
                                  {isExpired ? "Renew now →" : "Review →"}
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resolve Alert Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 dark:border-gray-800">
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-1">
              Resolve {selectedAlert.alertCategory === "DOCUMENT_ERROR" ? "Document Error" : "Fraud Alert"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Document your investigation findings and actions taken.
            </p>
            {alertError && <div className="mb-3 p-3 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 rounded">{alertError}</div>}
            <form onSubmit={handleResolveAlert} className="space-y-4">
              <textarea
                value={resolutionNote}
                onChange={e => setResolutionNote(e.target.value)}
                rows={4}
                required
                placeholder="Detail the investigation steps and actions taken…"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setSelectedAlert(null)} disabled={alertLoading} className="px-4 py-2 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition">Cancel</button>
                <button type="submit" disabled={alertLoading} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1">
                  {alertLoading && <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />}
                  Confirm Resolve
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Risk Review Modal */}
      {selectedReview && reviewAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 dark:border-gray-800">
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-1">
              {reviewAction === "CLEAR" ? "Clear Risk Review" : reviewAction === "SUSPEND" ? "Suspend NGO" : "Escalate for Review"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {selectedReview.ngo.orgName}
            </p>
            {reviewAction === "SUSPEND" && (
              <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-700 dark:text-amber-400 rounded-lg font-semibold">
                This will suspend the NGO's profile. Donors will no longer be able to donate to their campaigns.
              </div>
            )}
            {reviewError && <div className="mb-3 p-3 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 rounded">{reviewError}</div>}
            <form onSubmit={handleRiskReview} className="space-y-4">
              <textarea
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                rows={4}
                required
                placeholder="Document your decision and the evidence reviewed…"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => { setSelectedReview(null); setReviewAction(null); }} disabled={reviewLoading} className="px-4 py-2 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition">Cancel</button>
                <button type="submit" disabled={reviewLoading} className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 ${reviewAction === "SUSPEND" ? "bg-red-600 hover:bg-red-700" : reviewAction === "CLEAR" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700"}`}>
                  {reviewLoading && <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />}
                  Confirm {reviewAction}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
