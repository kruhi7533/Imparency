"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Week 6 funding panel, shared by the contract page (donor + NGO) and the NGO
 * project cockpit. Shows the funding summary, lets the NGO accept the funded
 * project and confirm/dispute payments, and lets the donor record a sandbox or
 * manual payment. All rules are enforced server-side; this only hides buttons.
 */

export interface PanelPayment {
  id: string;
  amount: number;
  mode: "SANDBOX" | "MANUAL";
  reference: string | null;
  paidAt: string;
  note: string | null;
  status: "PENDING_CONFIRMATION" | "RECONCILED" | "DISPUTED";
  disputeNote: string | null;
  contractMilestoneId: string | null;
}

export interface PanelSummary {
  committed: string;
  recorded: string;
  reconciled: string;
  pending: string;
  disputed: string;
  state: "UNFUNDED" | "PARTIALLY_FUNDED" | "FUNDED" | "OVERFUNDED";
}

export interface PanelViewer {
  party: "DONOR" | "NGO" | "ADMIN";
  canAccept: boolean;
  canConfirm: boolean;
}

const STATE_BADGE: Record<PanelSummary["state"], { cls: string; label: string }> = {
  UNFUNDED: { cls: "bg-gray-100 text-gray-600", label: "Unfunded" },
  PARTIALLY_FUNDED: { cls: "bg-amber-100 text-amber-700", label: "Partially funded" },
  FUNDED: { cls: "bg-emerald-100 text-emerald-700", label: "Fully funded" },
  OVERFUNDED: { cls: "bg-red-100 text-red-700", label: "Overfunded — check" },
};

const PAYMENT_BADGE: Record<PanelPayment["status"], { cls: string; label: string }> = {
  PENDING_CONFIRMATION: { cls: "bg-amber-100 text-amber-700", label: "Awaiting NGO confirmation" },
  RECONCILED: { cls: "bg-emerald-100 text-emerald-700", label: "Reconciled" },
  DISPUTED: { cls: "bg-red-100 text-red-700", label: "Disputed" },
};

const inr = (v: string | number) =>
  `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ContractPaymentsPanel({
  contractId,
  contractStatus,
  ngoAcceptedAt,
  viewer,
  milestones,
  payments,
  summary,
}: {
  contractId: string;
  contractStatus: string;
  ngoAcceptedAt: string | null;
  viewer: PanelViewer;
  milestones: Array<{ id: string; title: string; allocatedAmount: number }>;
  payments: PanelPayment[];
  summary: PanelSummary;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    mode: "SANDBOX" as "SANDBOX" | "MANUAL",
    amount: "",
    contractMilestoneId: "",
    reference: "",
    paidAt: new Date().toISOString().slice(0, 10),
    note: "",
  });
  // One key per form opening: a double-submit replays instead of paying twice.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);

  const isActive = contractStatus === "ACTIVE";
  const accepted = !!ngoAcceptedAt;
  const badge = STATE_BADGE[summary.state];
  const milestoneTitle = (id: string | null) => milestones.find((m) => m.id === id)?.title ?? "Whole contract";

  async function call(url: string, method: string, body: unknown, done: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      done();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const accept = () => {
    if (!confirm("Accept this funded project, its approved budget and milestones?")) return;
    call(`/api/contracts/${contractId}/accept`, "POST", {}, () => {});
  };

  const record = (e: React.FormEvent) => {
    e.preventDefault();
    call(
      `/api/contracts/${contractId}/payments`,
      "POST",
      {
        ...form,
        contractMilestoneId: form.contractMilestoneId || null,
        paidAt: new Date(form.paidAt).toISOString(),
        idempotencyKey,
      },
      () => {
        setShowForm(false);
        setIdempotencyKey(newKey());
        setForm((f) => ({ ...f, amount: "", reference: "", note: "" }));
      },
    );
  };

  const decide = (paymentId: string, decision: "CONFIRM" | "DISPUTE") => {
    let note: string | null = null;
    if (decision === "DISPUTE") {
      note = prompt("What is wrong with this payment? (e.g. not received, different amount)");
      if (!note) return;
    } else if (!confirm("Confirm this money has arrived in your account?")) {
      return;
    }
    call(`/api/contracts/${contractId}/payments/${paymentId}`, "PATCH", { decision, note }, () => {});
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Funding & Reconciliation</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            The donor records a payment; it counts as funded only once the NGO confirms it arrived.
          </p>
        </div>
        <span className={`self-start px-3 py-1 rounded-full text-xs font-extrabold ${badge.cls}`}>{badge.label}</span>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Committed" value={inr(summary.committed)} />
        <Stat label="Reconciled" value={inr(summary.reconciled)} tone="text-emerald-600" />
        <Stat label="Awaiting confirmation" value={inr(summary.pending)} tone="text-amber-600" />
        <Stat label="Disputed" value={inr(summary.disputed)} tone="text-red-600" />
      </div>

      {/* Acceptance gate */}
      {isActive && !accepted && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {viewer.party === "NGO"
              ? "This contract is active. Accept the funded project to start receiving payments."
              : "Waiting for the NGO to accept the funded project before payments can be recorded."}
          </p>
          {viewer.party === "NGO" && viewer.canAccept && (
            <button
              onClick={accept}
              disabled={busy}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
            >
              Accept funded project
            </button>
          )}
          {viewer.party === "NGO" && !viewer.canAccept && (
            <span className="text-xs text-amber-700">Ask an NGO owner or admin to accept.</span>
          )}
        </div>
      )}
      {accepted && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
          ✓ Accepted by the NGO on {new Date(ngoAcceptedAt!).toLocaleDateString("en-IN")}
        </p>
      )}

      {/* Donor: record a payment */}
      {viewer.party === "DONOR" && isActive && accepted && (
        <div>
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl"
            >
              + Record payment
            </button>
          ) : (
            <form onSubmit={record} className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/40">
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                Payment type
                <select
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value as "SANDBOX" | "MANUAL" })}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
                >
                  <option value="SANDBOX">Sandbox (simulated, no real money)</option>
                  <option value="MANUAL">Manual bank transfer (NEFT/RTGS/cheque)</option>
                </select>
              </label>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                Milestone
                <select
                  value={form.contractMilestoneId}
                  onChange={(e) => setForm({ ...form, contractMilestoneId: e.target.value })}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
                >
                  <option value="">Whole contract (not milestone-specific)</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} — {inr(m.allocatedAmount)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                Amount (₹)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
                />
              </label>
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                Paid on
                <input
                  type="date"
                  required
                  value={form.paidAt}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
                />
              </label>
              {form.mode === "MANUAL" && (
                <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  Bank reference (UTR / cheque no.)
                  <input
                    required
                    value={form.reference}
                    onChange={(e) => setForm({ ...form, reference: e.target.value })}
                    className="mt-1 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
                  />
                </label>
              )}
              <label className="text-xs font-bold text-gray-700 dark:text-gray-300 sm:col-span-2">
                Note (optional)
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="mt-1 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
                />
              </label>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-xs font-bold text-gray-600">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  {busy ? "Recording…" : "Record payment"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Payments ledger */}
      {payments.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No payments recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-[11px] font-bold uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-3 py-2">Paid on</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Type / reference</th>
                <th className="px-3 py-2">Milestone</th>
                <th className="px-3 py-2">Reconciliation</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {payments.map((p) => {
                const pb = PAYMENT_BADGE[p.status];
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-gray-500">{new Date(p.paidAt).toLocaleDateString("en-IN")}</td>
                    <td className="px-3 py-2 font-bold text-gray-900 dark:text-white">{inr(p.amount)}</td>
                    <td className="px-3 py-2">
                      <span className={`mr-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${p.mode === "SANDBOX" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                        {p.mode}
                      </span>
                      <span className="font-mono text-gray-500">{p.reference}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{milestoneTitle(p.contractMilestoneId)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${pb.cls}`}>{pb.label}</span>
                      {p.disputeNote && <p className="text-[11px] text-red-600 mt-1">{p.disputeNote}</p>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {viewer.party === "NGO" && viewer.canConfirm && p.status === "PENDING_CONFIRMATION" && (
                        <>
                          <button
                            onClick={() => decide(p.id, "CONFIRM")}
                            disabled={busy}
                            className="px-2.5 py-1 bg-emerald-600 text-white font-bold text-[11px] rounded-lg disabled:opacity-50"
                          >
                            Confirm received
                          </button>
                          <button
                            onClick={() => decide(p.id, "DISPUTE")}
                            disabled={busy}
                            className="ml-1 px-2.5 py-1 text-red-600 font-bold text-[11px] rounded-lg hover:bg-red-50 disabled:opacity-50"
                          >
                            Dispute
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "text-gray-900 dark:text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-400">{label}</p>
      <p className={`text-lg font-extrabold mt-0.5 ${tone}`}>{value}</p>
    </div>
  );
}
