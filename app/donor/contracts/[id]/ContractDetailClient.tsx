"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ContractPaymentsPanel from "./ContractPaymentsPanel";

interface SerializedContract {
  id: string;
  contractNumber: string;
  title: string;
  description: string | null;
  status: string;
  totalGrantAmount: number;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  governingLaw: string;
  csrScheduleViiCategory: string | null;
  reportingCadence: string;
  termsAndConditions: string;
  donorSignedAt: string | null;
  donorSignedByName: string | null;
  donorSignerTitle: string | null;
  donorSignerIp: string | null;
  ngoSignedAt: string | null;
  ngoSignedByName: string | null;
  ngoSignerTitle: string | null;
  ngoSignerIp: string | null;
  createdAt: string;
  donor: {
    id: string;
    name: string;
    email: string;
    companyName: string | null;
    isCorporate: boolean;
    gstNumber: string | null;
    donorPersona: string | null;
  };
  ngo: {
    id: string;
    orgName: string;
    panNumber: string;
    registrationNumber: string;
    logo_url: string | null;
    website: string | null;
    address: string;
  };
  project: {
    id: string;
    title: string;
    description: string;
    location: string;
    coverImage: string | null;
    targetAmount: number;
    raisedAmount: number;
    causeCategory: string;
  };
  milestones: Array<{
    id: string;
    title: string;
    description: string;
    allocatedAmount: number;
    status: string;
    deliverables: string[];
    dueDate: string | null;
    completedAt: string | null;
    orderIndex: number;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    actorRole: string;
    detail: string | null;
    createdAt: string;
  }>;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: "bg-gray-100", text: "text-gray-600", label: "Draft" },
  PROPOSED: { bg: "bg-amber-100", text: "text-amber-700", label: "Proposed" },
  UNDER_REVIEW: { bg: "bg-purple-100", text: "text-purple-700", label: "Under Review" },
  ACTIVE: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Active" },
  COMPLETED: { bg: "bg-blue-100", text: "text-blue-700", label: "Completed" },
  TERMINATED: { bg: "bg-red-100", text: "text-red-700", label: "Terminated" },
  REJECTED: { bg: "bg-rose-100", text: "text-rose-700", label: "Rejected" },
};

export default function ContractDetailClient({
  contract,
  currentUser,
  funding,
}: {
  contract: SerializedContract;
  currentUser: { id: string; role: string; name: string; email: string };
  funding: React.ComponentProps<typeof ContractPaymentsPanel> & { milestoneStates: Record<string, string> };
}) {
  const router = useRouter();

  const [signerName, setSignerName] = useState(currentUser.name);
  const [signerTitle, setSignerTitle] = useState(
    currentUser.role === "DONOR" ? "Authorized CSR Representative" : "Authorized NGO Trustee"
  );
  const [showSignModal, setShowSignModal] = useState(false);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminateReason, setTerminateReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isDonor = currentUser.role === "DONOR";
  const isNgo = currentUser.role === "NGO";
  const badge = STATUS_BADGE[contract.status] || STATUS_BADGE.DRAFT;

  const userHasSigned = isDonor ? !!contract.donorSignedAt : !!contract.ngoSignedAt;
  const canSign =
    (contract.status === "PROPOSED" || contract.status === "DRAFT" || contract.status === "UNDER_REVIEW") &&
    !userHasSigned;

  const totalDisbursed = contract.milestones
    .filter((m) => m.status === "DISBURSED")
    .reduce((sum, m) => sum + m.allocatedAmount, 0);
  const progressPct = contract.totalGrantAmount > 0 ? Math.round((totalDisbursed / contract.totalGrantAmount) * 100) : 0;

  const handlePropose = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/contracts/${contract.id}/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Agreement proposed for formal counter-execution." }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to propose contract");
      }
      setSuccessMsg("Contract has been formally proposed to the NGO!");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signerName.trim() || !signerTitle.trim()) {
      setError("Please fill in your full legal name and designation.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerTitle: signerTitle.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to execute electronic signature.");
      }
      setShowSignModal(false);
      setSuccessMsg("Electronic signature recorded successfully!");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisburseMilestone = async (milestoneId: string, milestoneTitle: string) => {
    if (!confirm(`Authorize milestone release of funds for "${milestoneTitle}"?`)) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/contracts/${contract.id}/milestones/${milestoneId}/disburse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Milestone proof verified by Donor. Grant tranche released." }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to disburse milestone");
      }
      setSuccessMsg(`Milestone "${milestoneTitle}" funds disbursed!`);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTerminate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminateReason.trim()) {
      setError("Please specify a reason for early termination.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/contracts/${contract.id}/terminate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: terminateReason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to terminate agreement");
      }
      setShowTerminateModal(false);
      setSuccessMsg("Contract has been marked as TERMINATED.");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href={isDonor ? "/donor/contracts" : isNgo ? "/ngo/contracts" : "/admin/donors"}
            className="text-xs font-bold text-emerald-700 hover:underline"
          >
            {isDonor || isNgo ? "← Back to All Contracts" : "← Back to donors"}
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">{contract.title}</h1>
            <span className={`px-3 py-0.5 rounded-full text-xs font-extrabold ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs font-mono text-gray-600 mt-0.5">
            Ref: {contract.contractNumber} · Created on {new Date(contract.createdAt).toLocaleDateString("en-IN")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {contract.status === "DRAFT" && (
            <button
              onClick={handlePropose}
              disabled={loading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
            >
              Propose Agreement →
            </button>
          )}
          {canSign && (
            <button
              onClick={() => setShowSignModal(true)}
              className="px-4 py-2 bg-trust-600 hover:bg-trust-700 text-white text-xs font-bold rounded-xl transition shadow-sm animate-pulse"
            >
              Sign Agreement (E-Sign)
            </button>
          )}
          {contract.status === "ACTIVE" && (
            <button
              onClick={() => setShowTerminateModal(true)}
              className="px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl transition"
            >
              Terminate Agreement
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {successMsg}
        </div>
      )}

      {/* Grid: Parties & Dual-Signature Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Donor Party & Sign Status */}
        <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wider text-gray-600">Grantor / Donor Organization</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                contract.donorSignedAt ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              {contract.donorSignedAt ? "✓ Signed" : "Pending Signature"}
            </span>
          </div>

          <div className="space-y-1 text-sm">
            <p className="font-bold text-gray-900">
              {contract.donor.companyName || contract.donor.name}
            </p>
            <p className="text-xs text-gray-500">{contract.donor.email}</p>
            {contract.donor.gstNumber && <p className="text-xs text-gray-600">GST: {contract.donor.gstNumber}</p>}
            {contract.donor.donorPersona && (
              <span className="inline-block mt-1 text-[10px] font-extrabold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                {contract.donor.donorPersona}
              </span>
            )}
          </div>

          <div className="pt-3 border-t border-gray-100 text-xs">
            {contract.donorSignedAt ? (
              <div className="space-y-0.5 text-emerald-700">
                <p className="font-semibold">Electronically signed{contract.donorSignedByName ? ` by ${contract.donorSignedByName}` : ""}</p>
                <p className="text-[11px] text-gray-500">
                  {[contract.donorSignerTitle, new Date(contract.donorSignedAt).toLocaleString("en-IN")].filter(Boolean).join(" · ")}
                </p>
                {contract.donorSignerIp && <p className="text-[10px] text-gray-600 font-mono">IP: {contract.donorSignerIp}</p>}
              </div>
            ) : (
              <p className="text-gray-600 italic">Signature pending from Grantor representative.</p>
            )}
          </div>
        </div>

        {/* NGO Party & Sign Status */}
        <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wider text-gray-600">Grantee / Partner NGO</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                contract.ngoSignedAt ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              {contract.ngoSignedAt ? "✓ Signed" : "Pending Signature"}
            </span>
          </div>

          <div className="space-y-1 text-sm">
            <p className="font-bold text-gray-900">{contract.ngo.orgName}</p>
            <p className="text-xs text-gray-500">PAN: {contract.ngo.panNumber}</p>
            <p className="text-xs text-gray-600">{contract.ngo.address}</p>
            {contract.ngo.website && (
              <a
                href={contract.ngo.website}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-700 hover:underline block"
              >
                {contract.ngo.website}
              </a>
            )}
          </div>

          <div className="pt-3 border-t border-gray-100 text-xs">
            {contract.ngoSignedAt ? (
              <div className="space-y-0.5 text-emerald-700">
                <p className="font-semibold">Electronically signed{contract.ngoSignedByName ? ` by ${contract.ngoSignedByName}` : ""}</p>
                <p className="text-[11px] text-gray-500">
                  {[contract.ngoSignerTitle, new Date(contract.ngoSignedAt).toLocaleString("en-IN")].filter(Boolean).join(" · ")}
                </p>
                {contract.ngoSignerIp && <p className="text-[10px] text-gray-600 font-mono">IP: {contract.ngoSignerIp}</p>}
              </div>
            ) : (
              <p className="text-gray-600 italic">Signature pending from NGO Authorized Signatory.</p>
            )}
          </div>
        </div>
      </div>

      {/* Grant Summary & Project Opportunity */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-xs font-bold text-gray-600">Total Committed Grant</p>
            <p className="text-xl font-extrabold text-gray-900 mt-0.5">
              ₹{contract.totalGrantAmount.toLocaleString("en-IN")}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-600">Disbursed to Date</p>
            <p className="text-xl font-extrabold text-emerald-700 mt-0.5">
              ₹{totalDisbursed.toLocaleString("en-IN")} <span className="text-xs font-normal text-gray-500">({progressPct}%)</span>
            </p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-600">CSR Classification</p>
            <p className="text-xs text-gray-800 mt-1 line-clamp-2">
              {contract.csrScheduleViiCategory || "Section 135 Compliant"}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-600">Linked Opportunity</p>
            <Link
              href={`/projects/${contract.project.id}`}
              className="text-xs font-bold text-emerald-700 hover:underline mt-1 block"
            >
              {contract.project.title} →
            </Link>
            {isDonor && (contract.status === "ACTIVE" || contract.status === "COMPLETED") && (
              <Link
                href={`/donor/funded/${contract.project.id}`}
                className="text-xs font-bold text-blue-700 hover:underline mt-1 block"
              >
                Milestone progress & verified evidence →
              </Link>
            )}
            {isNgo && (
              <Link
                href={`/ngo/projects/${contract.project.id}`}
                className="text-xs font-bold text-blue-700 hover:underline mt-1 block"
              >
                Project page: milestones, funding & field work →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Week 6: payments and reconciliation */}
      <ContractPaymentsPanel {...funding} />

      {/* Milestone Disbursement Schedule */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Milestone Disbursement Gates</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Progressive funding tranches unlocked upon deliverable verification.
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold text-gray-500">{progressPct}% Disbursed</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-600 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Milestone & Deliverables</th>
                <th className="px-4 py-3">Target Date</th>
                <th className="px-4 py-3">Committed amount</th>
                <th className="px-4 py-3">Disbursement Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contract.milestones.map((m, idx) => (
                <tr key={m.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-bold text-gray-600">{idx + 1}</td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="font-bold text-gray-900 text-sm">{m.title}</p>
                    <p className="text-gray-500 mt-0.5">{m.description}</p>
                    {m.deliverables?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {m.deliverables.map((d, dIdx) => (
                          <span
                            key={dIdx}
                            className="px-2 py-0.5 rounded bg-gray-100 text-[10px] text-gray-600"
                          >
                            ✓ {d}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {m.dueDate ? new Date(m.dueDate).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-4 py-3 font-bold text-gray-900 text-sm">
                    ₹{m.allocatedAmount.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                        m.status === "DISBURSED"
                          ? "bg-emerald-100 text-emerald-700"
                          : m.status === "VERIFIED"
                          ? "bg-blue-100 text-blue-700"
                          : m.status === "PROOF_SUBMITTED"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {contract.status === "ACTIVE" && isDonor && m.status !== "DISBURSED" &&
                      funding.milestoneStates[m.id] === "FUNDED" && (
                      <button
                        onClick={() => handleDisburseMilestone(m.id, m.title)}
                        disabled={loading}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-lg transition shadow-sm disabled:opacity-50"
                      >
                        Authorize Release
                      </button>
                    )}
                    {m.status === "DISBURSED" && (
                      <span className="text-xs text-emerald-700 font-semibold">Released ✓</span>
                    )}
                    {contract.status === "ACTIVE" && m.status !== "DISBURSED" && funding.milestoneStates[m.id] !== "FUNDED" && (
                      <span className="text-[11px] text-gray-600">Release after payment is reconciled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Terms & Conditions Box */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-3">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-600">Legal Covenants & Operating Terms</h2>
        <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 text-xs font-mono whitespace-pre-line text-gray-700 leading-relaxed max-h-64 overflow-y-auto">
          {contract.termsAndConditions}
        </div>
      </div>

      {/* Immutable Audit Timeline */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-600">Contract Execution & Audit Log</h2>
        <div className="space-y-3">
          {contract.auditLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-gray-900">
                  {log.action} <span className="text-gray-600 font-normal">by {log.actorRole}</span>
                </p>
                <p className="text-gray-600 mt-0.5">{log.detail}</p>
              </div>
              <span className="text-[11px] text-gray-600">{new Date(log.createdAt).toLocaleString("en-IN")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* E-Signature Modal */}
      {showSignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
          <form
            onSubmit={handleSign}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200/80 space-y-4"
          >
            <h3 className="text-lg font-bold text-gray-900">Execute Grant Agreement</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              By executing this digital signature, you confirm that you are an authorized representative of{" "}
              <span className="font-bold">{isDonor ? contract.donor.companyName || contract.donor.name : contract.ngo.orgName}</span> and
              agree to the covenants and milestone terms herein.
            </p>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Full Legal Name of Signatory
                </label>
                <input
                  type="text"
                  required
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-300 rounded-xl px-3.5 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-trust-500/20 focus:border-trust-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Designation / Official Title
                </label>
                <input
                  type="text"
                  required
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-300 rounded-xl px-3.5 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-trust-500/20 focus:border-trust-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={() => setShowSignModal(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 bg-trust-600 hover:bg-trust-700 text-white text-xs font-bold rounded-xl shadow-sm transition disabled:opacity-50"
              >
                {loading ? "Recording Signature…" : "Confirm Electronic Signature"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Terminate Modal */}
      {showTerminateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
          <form
            onSubmit={handleTerminate}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200/80 space-y-4"
          >
            <h3 className="text-lg font-bold text-red-600">Terminate Grant Agreement</h3>
            <p className="text-xs text-gray-500">
              Please specify the operational or contractual reason for early termination. This will be recorded permanently in the audit ledger.
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Reason for Termination</label>
              <textarea
                rows={3}
                required
                value={terminateReason}
                onChange={(e) => setTerminateReason(e.target.value)}
                className="w-full text-xs bg-white border border-gray-300 rounded-xl p-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                placeholder="e.g. Mutual consent due to project scope redefinition..."
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTerminateModal(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-sm transition disabled:opacity-50"
              >
                {loading ? "Terminating…" : "Confirm Termination"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
