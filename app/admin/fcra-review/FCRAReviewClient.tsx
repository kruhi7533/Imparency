"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface QuarterlyReport {
  id: string;
  quarter: string;
  generatedAt: string;
  totalNgos: number;
  activeCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  rejectedCount: number;
  pendingCount: number;
}

interface FcraRecord {
  id: string;
  ngoId: string;
  orgName: string;
  email: string;
  fcraNumber: string | null;
  fcraStatus: string;
  fcraAuthority: string | null;
  fcraRegisteredSince: number | null;
  fcraIssueDate: string | null;
  fcraExpiryDate: string | null;
  fcraCertificateUrl: string | null;
  fcraExtractedData: any;
  fcraAdminNote: string | null;
  updatedAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400",
  REUPLOAD_REQUESTED: "bg-orange-100 text-orange-800 dark:bg-orange-950/20 dark:text-orange-400",
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
  EXPIRING_SOON: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-400",
  EXPIRED: "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending Review",
  REUPLOAD_REQUESTED: "Re-upload Requested",
  ACTIVE: "Active",
  EXPIRING_SOON: "Expiring Soon",
  EXPIRED: "Expired",
  REJECTED: "Rejected",
};

const PENDING_STATES = ["PENDING", "REUPLOAD_REQUESTED"];

export default function FCRAReviewClient({
  initialRecords,
  initialReports,
}: {
  initialRecords: FcraRecord[];
  initialReports: QuarterlyReport[];
}) {
  const router = useRouter();
  const [records, setRecords] = useState<FcraRecord[]>(initialRecords);
  const [reports, setReports] = useState<QuarterlyReport[]>(initialReports);
  const [tab, setTab] = useState<"PENDING" | "HISTORY" | "REPORTS">("PENDING");
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState("");

  const [selected, setSelected] = useState<FcraRecord | null>(null);
  const [action, setAction] = useState<"APPROVE" | "REJECT" | "REUPLOAD" | null>(null);
  const [note, setNote] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [authority, setAuthority] = useState("");
  const [registeredSince, setRegisteredSince] = useState("");
  const [fcraNumber, setFcraNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const pending = records.filter((r) => PENDING_STATES.includes(r.fcraStatus));
  const history = records.filter((r) => !PENDING_STATES.includes(r.fcraStatus));
  const visible = tab === "PENDING" ? pending : history;

  const expiringSoon = records.filter((r) => r.fcraStatus === "EXPIRING_SOON");

  // Compute days until end of current quarter
  const now = new Date();
  const quarterEnds = [
    new Date(now.getFullYear(), 2, 31),  // March 31
    new Date(now.getFullYear(), 5, 30),  // June 30
    new Date(now.getFullYear(), 8, 30),  // September 30
    new Date(now.getFullYear(), 11, 31), // December 31
  ];
  const nextQuarterEnd = quarterEnds.find((d) => d > now) ?? quarterEnds[3];
  const daysToQuarterEnd = Math.ceil((nextQuarterEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const showUrgencyBanner = expiringSoon.length > 0 && daysToQuarterEnd <= 30;

  const isoToInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

  const openModal = (rec: FcraRecord, type: "APPROVE" | "REJECT" | "REUPLOAD") => {
    const ex = rec.fcraExtractedData?.extracted_data || {};
    setSelected(rec);
    setAction(type);
    setNote("");
    setError("");
    setFcraNumber(rec.fcraNumber || ex.fcra_number || "");
    setExpiryDate(isoToInput(rec.fcraExpiryDate) || "");
    setIssueDate(isoToInput(rec.fcraIssueDate) || "");
    setAuthority(rec.fcraAuthority || ex.authority || "Ministry of Home Affairs");
    setRegisteredSince(rec.fcraRegisteredSince ? String(rec.fcraRegisteredSince) : "");
  };

  const closeModal = () => {
    setSelected(null);
    setAction(null);
    setNote("");
    setError("");
  };

  const generateReport = async () => {
    setGeneratingReport(true);
    setReportError("");
    try {
      const res = await fetch("/api/admin/fcra-report/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate report");
      router.refresh();
      setTab("REPORTS");
    } catch (err: any) {
      setReportError(err.message);
    } finally {
      setGeneratingReport(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !action) return;
    if ((action === "REJECT" || action === "REUPLOAD") && !note.trim()) {
      setError("A note is required so the NGO knows what to fix.");
      return;
    }
    if (action === "APPROVE" && !expiryDate) {
      setError("Set the FCRA expiry date to approve.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/review-fcra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ngoId: selected.ngoId,
          action,
          adminNote: note.trim(),
          fcraNumber: fcraNumber.trim() || null,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          authority: authority.trim() || null,
          registeredSince: registeredSince || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      setRecords((prev) =>
        prev.map((r) => (r.id === selected.id ? { ...r, fcraStatus: data.fcraStatus } : r))
      );
      closeModal();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderExtraction = (rec: FcraRecord) => {
    const ex = rec.fcraExtractedData?.extracted_data;
    if (!rec.fcraExtractedData) {
      return (
        <p className="text-[11px] text-gray-400 italic">AI extraction pending or unavailable — review the certificate manually.</p>
      );
    }
    const flags = rec.fcraExtractedData.flags || [];
    return (
      <div className="text-xs space-y-1.5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-gray-400">Extracted FCRA No.</span>
          <span className="font-bold text-gray-800 dark:text-gray-200">{ex?.fcra_number || "—"}</span>
          <span className="text-gray-400">Extracted Org</span>
          <span className="font-bold text-gray-800 dark:text-gray-200">{ex?.org_name || "—"}</span>
          <span className="text-gray-400">Issue / Valid Until</span>
          <span className="font-bold text-gray-800 dark:text-gray-200">{(ex?.issue_date || "—") + " → " + (ex?.validity_date || "—")}</span>
          <span className="text-gray-400">Number matches form</span>
          <span className={rec.fcraExtractedData.number_matches_form ? "text-emerald-600 font-bold" : "text-red-500 font-bold"}>
            {rec.fcraExtractedData.number_matches_form ? "✓ Yes" : "✗ No"}
          </span>
        </div>
        {flags.length > 0 && (
          <div className="pt-1 space-y-1">
            {flags.map((f: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className={`text-[9px] font-extrabold uppercase px-1 py-0.5 rounded ${f.severity === "HIGH" ? "bg-red-100 text-red-700" : f.severity === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{f.severity}</span>
                <span className="text-gray-600 dark:text-gray-300">{f.issue}</span>
              </div>
            ))}
          </div>
        )}
        {rec.fcraExtractedData.summary && (
          <p className="text-gray-500 dark:text-gray-400 italic pt-1">{rec.fcraExtractedData.summary}</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Quarter-end urgency banner */}
      {showUrgencyBanner && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl">
          <div className="text-amber-500 text-lg leading-none mt-0.5">⚠</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-amber-900 dark:text-amber-300">
              {expiringSoon.length} NGO{expiringSoon.length > 1 ? "s" : ""} with FCRA expiring — {daysToQuarterEnd} day{daysToQuarterEnd !== 1 ? "s" : ""} to quarter end
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Quarter closes {nextQuarterEnd.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}. Review and renew before the deadline to avoid blocking foreign donations.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {expiringSoon.map((r) => (
                <span key={r.id} className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full">
                  {r.orgName}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => setTab("HISTORY")}
            className="shrink-0 text-xs font-bold text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 underline underline-offset-2 transition"
          >
            View all →
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setTab("PENDING")}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition ${tab === "PENDING" ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700"}`}
        >
          Pending Review {pending.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px]">{pending.length}</span>}
        </button>
        <button
          onClick={() => setTab("HISTORY")}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition ${tab === "HISTORY" ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700"}`}
        >
          History ({history.length})
        </button>
        <button
          onClick={() => setTab("REPORTS")}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition ${tab === "REPORTS" ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700"}`}
        >
          Quarterly Reports {reports.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[10px]">{reports.length}</span>}
        </button>
      </div>

      {/* Quarterly Reports tab */}
      {tab === "REPORTS" && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-start gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Auto-generated at the end of each quarter. Regenerate at any time to capture the latest state.
            </p>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <button
                onClick={generateReport}
                disabled={generatingReport}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded-xl transition"
              >
                {generatingReport && <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />}
                Generate Now
              </button>
              {reportError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold">{reportError}</p>
              )}
            </div>
          </div>

          {reports.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center shadow-sm">
              <span className="text-4xl mb-4 block">📊</span>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">No quarterly reports yet</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Reports are auto-generated at the end of each quarter. You can also generate one manually above.
              </p>
            </div>
          ) : (
            reports.map((report) => (
              <div key={report.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-black text-gray-900 dark:text-white">{report.quarter} FCRA Report</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Generated {new Date(report.generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <a
                    href={`/api/admin/fcra-report/${report.id}/export`}
                    className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold px-4 py-2 rounded-xl transition"
                    download
                  >
                    Download CSV
                  </a>
                </div>
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { label: "Total NGOs", value: report.totalNgos, color: "text-gray-800 dark:text-gray-200" },
                    { label: "Active", value: report.activeCount, color: "text-emerald-600" },
                    { label: "Expiring Soon", value: report.expiringSoonCount, color: "text-amber-600" },
                    { label: "Expired", value: report.expiredCount, color: "text-orange-600" },
                    { label: "Rejected", value: report.rejectedCount, color: "text-slate-500" },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 text-center">
                      <div className={`text-xl font-black ${stat.color}`}>{stat.value}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold mt-0.5">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab !== "REPORTS" && visible.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
          <span className="text-4xl mb-4 block">🌍</span>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            {tab === "PENDING" ? "No FCRA submissions awaiting review" : "No reviewed FCRA records yet"}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {tab === "PENDING" ? "When NGOs submit FCRA certificates, they'll appear here for verification." : "Approved, rejected, and expired FCRA records will show up here."}
          </p>
        </div>
      )}

      {tab !== "REPORTS" && visible.length > 0 && (
        <div className="space-y-4">
          {visible.map((rec) => (
            <div key={rec.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-black text-gray-900 dark:text-white">{rec.orgName}</h3>
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_BADGE[rec.fcraStatus] || "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABEL[rec.fcraStatus] || rec.fcraStatus}
                    </span>
                    <a
                      href="/admin/risk-compliance"
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline underline-offset-2"
                    >
                      Compliance →
                    </a>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rec.email}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">FCRA No: <span className="font-semibold">{rec.fcraNumber || "—"}</span></p>
                  {rec.fcraCertificateUrl && (
                    <a href={rec.fcraCertificateUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 hover:underline font-semibold">
                      View FCRA Certificate (PDF)
                    </a>
                  )}
                  {rec.fcraAdminNote && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">Last note: {rec.fcraAdminNote}</p>
                  )}
                </div>
                {PENDING_STATES.includes(rec.fcraStatus) && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openModal(rec, "APPROVE")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition">Approve</button>
                    <button onClick={() => openModal(rec, "REUPLOAD")} className="bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 font-bold py-1.5 px-3 rounded-lg text-xs transition">Request Re-upload</button>
                    <button onClick={() => openModal(rec, "REJECT")} className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 hover:bg-red-100 font-bold py-1.5 px-3 rounded-lg text-xs transition">Reject</button>
                  </div>
                )}
              </div>
              <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3">
                {renderExtraction(rec)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {selected && action && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 dark:border-gray-800 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-1">
              {action === "APPROVE" ? "Approve FCRA" : action === "REJECT" ? "Reject FCRA" : "Request Re-upload"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {action === "APPROVE"
                ? `Confirm the certificate details for "${selected.orgName}". The status is derived from the expiry date.`
                : `Tell "${selected.orgName}" what needs to change.`}
            </p>

            {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 rounded">{error}</div>}

            <form onSubmit={submit} className="space-y-4">
              {action === "APPROVE" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">FCRA Registration Number</label>
                    <input type="text" value={fcraNumber} onChange={(e) => setFcraNumber(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Issue Date</label>
                      <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Valid Until *</label>
                      <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Authority</label>
                      <input type="text" value={authority} onChange={(e) => setAuthority(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Registered Since (year)</label>
                      <input type="number" value={registeredSince} onChange={(e) => setRegisteredSince(e.target.value)} placeholder="2018" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {action === "APPROVE" ? "Note (optional)" : "Reason *"}
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  required={action !== "APPROVE"}
                  placeholder={action === "APPROVE" ? "Optional internal note..." : "Explain what the NGO needs to fix..."}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} disabled={loading} className="px-4 py-2 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition">Cancel</button>
                <button type="submit" disabled={loading} className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 ${action === "APPROVE" ? "bg-emerald-600 hover:bg-emerald-700" : action === "REJECT" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"} disabled:opacity-40`}>
                  {loading && <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>}
                  {action === "APPROVE" ? "Confirm Approval" : action === "REJECT" ? "Confirm Rejection" : "Request Re-upload"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
