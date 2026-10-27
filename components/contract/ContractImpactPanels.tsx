"use client";

import React, { useCallback, useEffect, useState } from "react";

/**
 * Contract page panels for workstream G, shared by /donor/contracts/[id] and
 * /ngo/contracts/[id]:
 *   - Utilisation (NGO-015): per-milestone spend vs funding; the NGO records
 *     expenses with a receipt, the donor reads.
 *   - Impact reports (NGO-017, DON-016, NGO-020): the NGO drafts and submits
 *     stored reports; the donor reads published ones and asks to renew or
 *     about the next opportunity; the NGO answers.
 * Every rule is enforced by the API; this only hides what a role cannot do.
 */

type Role = "DONOR" | "NGO" | "ADMIN";

interface Milestone {
  id: string;
  title: string;
}

const card = "bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 shadow-sm";
const btn = "px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50";
const input = "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm";

const inr = (v: string | number) => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN") : "—");

export default function ContractImpactPanels({
  contractId,
  projectId,
  role,
  milestones,
}: {
  contractId: string;
  projectId: string;
  role: Role;
  milestones: Milestone[];
}) {
  return (
    <div className="space-y-6">
      <UtilisationPanel contractId={contractId} role={role} milestones={milestones} />
      {role === "NGO" && <NgoReportsPanel contractId={contractId} />}
      {role === "DONOR" && <DonorReportsPanel contractId={contractId} />}
      {role === "DONOR" && <DonorStoriesPanel projectId={projectId} />}
    </div>
  );
}

// ─── Utilisation ────────────────────────────────────────────────────────────

function UtilisationPanel({ contractId, role, milestones }: { contractId: string; role: Role; milestones: Milestone[] }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [canRecord, setCanRecord] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ contractMilestoneId: milestones[0]?.id ?? "", amount: "", category: "MATERIALS", description: "", spentOn: new Date().toISOString().slice(0, 10) });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/contract-utilisation/${contractId}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load utilisation");
      setData(j);
      if (role === "NGO") {
        const r2 = await fetch(`/api/ngo/contracts/${contractId}/expenses`);
        if (r2.ok) setCanRecord(!!(await r2.json()).canRecord);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [contractId, role]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append("idempotencyKey", `exp-${crypto.randomUUID()}`);
      if (receipt) fd.append("receipt", receipt);
      const res = await fetch(`/api/ngo/contracts/${contractId}/expenses`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to record expense");
      setOpen(false);
      setForm({ ...form, amount: "", description: "" });
      setReceipt(null);
      await load();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const titleOf = (id: string) => milestones.find((m) => m.id === id)?.title ?? "Milestone";

  return (
    <section className={card} aria-labelledby="utilisation-h">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 id="utilisation-h" className="text-lg font-bold text-gray-900 dark:text-white">Fund utilisation</h2>
          <p className="text-xs text-gray-500">Spend recorded by the organisation against each milestone, vs money confirmed received.{role === "DONOR" ? " Read-only." : ""}</p>
        </div>
        {role === "NGO" && canRecord && (
          <button className={`${btn} bg-emerald-600 text-white`} onClick={() => setOpen(!open)}>
            {open ? "Cancel" : "Record expense"}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error} <button className="underline" onClick={load}>Retry</button></p>}
      {!data && !error && <p className="text-sm text-gray-500">Loading…</p>}

      {open && (
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3 mb-6 p-4 rounded-xl bg-gray-50 dark:bg-gray-950">
          <label className="text-xs font-semibold">Milestone
            <select className={input} value={form.contractMilestoneId} onChange={(e) => setForm({ ...form, contractMilestoneId: e.target.value })} required>
              {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Amount (₹)
            <input className={input} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="12500.00" required />
          </label>
          <label className="text-xs font-semibold">Category
            <select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {["PERSONNEL", "MATERIALS", "TRAVEL", "EQUIPMENT", "TRAINING", "ADMINISTRATIVE", "OTHER"].map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Date spent
            <input type="date" className={input} value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} required />
          </label>
          <label className="text-xs font-semibold sm:col-span-2">Description
            <input className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required maxLength={1000} />
          </label>
          <label className="text-xs font-semibold sm:col-span-2">Receipt (PDF / JPEG / PNG, ≤10 MB, stored privately)
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} className="block mt-1 text-sm" />
          </label>
          {formError && <p className="text-sm text-red-600 sm:col-span-2">{formError}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className={`${btn} bg-emerald-600 text-white`}>{busy ? "Saving…" : "Save expense"}</button>
          </div>
        </form>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
            <Stat label="Allocated" value={inr(data.totals.allocated)} />
            <Stat label="Received (confirmed)" value={inr(data.totals.received)} />
            <Stat label="Spent" value={inr(data.totals.spent)} />
            <Stat label="Utilisation of received" value={pct(data.totals.utilisationOfReceived)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Milestone</th><th>Allocated</th><th>Received</th><th>Spent</th><th>% of received</th><th>% of allocated</th></tr></thead>
              <tbody>
                {data.milestones.map((m: any) => (
                  <tr key={m.milestoneId} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1.5">{m.title}</td><td>{inr(m.allocated)}</td><td>{inr(m.received)}</td><td>{inr(m.spent)}</td><td>{pct(m.utilisationOfReceived)}</td><td>{pct(m.utilisationOfAllocated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mt-5 mb-2 text-sm font-bold">Expenses</h3>
          {data.expenses.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No expenses recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
              {data.expenses.map((e: any) => (
                <li key={e.id} className="py-2 flex flex-wrap gap-x-4 justify-between">
                  <span>{day(e.spentOn)} · {titleOf(e.contractMilestoneId)} · {e.category.toLowerCase()} — {e.description}</span>
                  <span className="font-semibold">{inr(e.amount)}{e.hasReceipt && <a className="ml-3 text-emerald-700 underline font-normal" href={`/api/contract-utilisation/${contractId}/receipt/${e.id}`} target="_blank" rel="noreferrer">Receipt</a>}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-950 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function Figures({ figures }: { figures: any[] }) {
  if (!figures.length) return <p className="text-sm text-gray-500 italic">No figures.</p>;
  return (
    <ul className="text-sm space-y-1">
      {figures.map((f) => (
        <li key={f.claimId} className="flex justify-between gap-3">
          <span>{f.metricName} <span className="text-xs text-gray-400">({day(f.periodStart)} – {day(f.periodEnd)})</span></span>
          {f.display.kind === "verified" ? (
            <span className="font-semibold">{Number(f.display.value).toLocaleString("en-IN")} {String(f.display.unit).toLowerCase()}</span>
          ) : (
            <span className="text-amber-700 font-semibold" title={f.display.reason}>unverified</span>
          )}
        </li>
      ))}
    </ul>
  );
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SUBMITTED: "bg-blue-100 text-blue-700",
  RETURNED: "bg-amber-100 text-amber-800",
  PUBLISHED: "bg-emerald-100 text-emerald-700",
  OPEN: "bg-blue-100 text-blue-700",
  ACCEPTED: "bg-emerald-100 text-emerald-700",
  DECLINED: "bg-red-100 text-red-700",
};
const Badge = ({ s }: { s: string }) => <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_BADGE[s] ?? "bg-gray-100"}`}>{s}</span>;
const KIND_LABEL: Record<string, string> = { RENEWAL: "Renewal", NEXT_OPPORTUNITY: "Next opportunity" };

// ─── NGO: stored reports ────────────────────────────────────────────────────

function NgoReportsPanel({ contractId }: { contractId: string }) {
  const [reports, setReports] = useState<any[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", summary: "", periodStart: "", periodEnd: "" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ngo/impact-reports?contractId=${encodeURIComponent(contractId)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load reports");
      setReports(j.reports);
      setCanEdit(j.canEdit);
    } catch (e: any) {
      setError(e.message);
    }
  }, [contractId]);
  useEffect(() => {
    load();
  }, [load]);

  const openReport = async (id: string) => {
    setOpenId(id);
    setDetail(null);
    const res = await fetch(`/api/ngo/impact-reports/${id}`);
    const j = await res.json();
    if (res.ok) setDetail(j);
    else setError(j.error || "Failed to load report");
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/ngo/impact-reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contractId, ...form }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to create report");
      setCreating(false);
      setForm({ title: "", summary: "", periodStart: "", periodEnd: "" });
      await load();
      await openReport(j.report.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/ngo/impact-reports/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SUBMIT" }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to submit");
      await load();
      await openReport(id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-labelledby="ngo-reports-h">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 id="ngo-reports-h" className="text-lg font-bold text-gray-900 dark:text-white">Impact reports to this funder</h2>
          <p className="text-xs text-gray-500">Built only from approved outcome claims in the period. Admin review publishes it to the funder.</p>
        </div>
        {canEdit && <button className={`${btn} bg-emerald-600 text-white`} onClick={() => setCreating(!creating)}>{creating ? "Cancel" : "New report"}</button>}
      </div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {creating && (
        <form onSubmit={create} className="grid sm:grid-cols-2 gap-3 mb-5 p-4 rounded-xl bg-gray-50 dark:bg-gray-950">
          <label className="text-xs font-semibold sm:col-span-2">Title<input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          <label className="text-xs font-semibold">Period start<input type="date" className={input} value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} required /></label>
          <label className="text-xs font-semibold">Period end<input type="date" className={input} value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} required /></label>
          <label className="text-xs font-semibold sm:col-span-2">Summary (your narrative)<textarea className={input} rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label>
          <div><button disabled={busy} className={`${btn} bg-emerald-600 text-white`}>{busy ? "Saving…" : "Save draft"}</button></div>
        </form>
      )}
      {!reports && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {reports && reports.length === 0 && <p className="text-sm text-gray-500 italic">No reports yet.</p>}
      <ul className="space-y-3">
        {reports?.map((r) => (
          <li key={r.id} className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button className="text-left font-semibold hover:underline" onClick={() => (openId === r.id ? setOpenId(null) : openReport(r.id))}>{r.title}</button>
              <span className="flex items-center gap-2 text-xs text-gray-500">{day(r.periodStart)} – {day(r.periodEnd)} <Badge s={r.status} /></span>
            </div>
            {r.status === "RETURNED" && r.reviewNote && <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded p-2">Returned by review: {r.reviewNote}</p>}
            {openId === r.id && (
              <div className="mt-3 space-y-3">
                {!detail ? <p className="text-sm text-gray-500">Loading…</p> : (
                  <>
                    {detail.report.summary && <p className="text-sm whitespace-pre-line">{detail.report.summary}</p>}
                    <div>
                      <h4 className="text-xs font-bold uppercase text-gray-500 mb-1">{r.status === "DRAFT" || r.status === "RETURNED" ? "Approved claims that will be included" : "Figures"}</h4>
                      <Figures figures={detail.figures} />
                    </div>
                    {detail.pendingNotIncluded?.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold uppercase text-gray-500 mb-1">In review — not included</h4>
                        <Figures figures={detail.pendingNotIncluded} />
                      </div>
                    )}
                    {canEdit && (r.status === "DRAFT" || r.status === "RETURNED") && (
                      <button disabled={busy || detail.figures.length === 0} onClick={() => submit(r.id)} className={`${btn} bg-blue-600 text-white`} title={detail.figures.length === 0 ? "Needs at least one approved claim in the period" : ""}>
                        Submit for review
                      </button>
                    )}
                    {detail.renewalRequests?.length > 0 && (
                      <p className="text-xs text-gray-600">Funder requests on this report: {detail.renewalRequests.map((q: any) => `${KIND_LABEL[q.kind]} (${q.status.toLowerCase()})`).join(", ")} — answer them in <a className="underline" href="/ngo/reporting">Reporting</a>.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Donor: published reports + renew / next opportunity ────────────────────

function DonorReportsPanel({ contractId }: { contractId: string }) {
  const [reports, setReports] = useState<any[] | null>(null);
  const [canRequest, setCanRequest] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState<{ reportId: string; kind: string } | null>(null);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/donor/contract-reports?contractId=${encodeURIComponent(contractId)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load reports");
      setReports(j.reports);
      setCanRequest(j.canRequest);
    } catch (e: any) {
      setError(e.message);
    }
  }, [contractId]);
  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    if (!asking) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/engagement/re-engage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: asking.reportId, kind: asking.kind, message, proposedAmount: amount || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to send request");
      setAsking(null);
      setMessage("");
      setAmount("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-labelledby="donor-reports-h">
      <h2 id="donor-reports-h" className="text-lg font-bold text-gray-900 dark:text-white">Impact reports</h2>
      <p className="text-xs text-gray-500 mb-4">Published after review. A figure shows only when its claim is approved and its evidence still holds; otherwise it reads “unverified”.</p>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {!reports && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {reports && reports.length === 0 && <p className="text-sm text-gray-500 italic">No published reports on this contract yet.</p>}
      <ul className="space-y-4">
        {reports?.map((r) => {
          const has = (k: string) => r.requests.find((q: any) => q.kind === k);
          return (
            <li key={r.id} className="rounded-xl border border-gray-100 dark:border-gray-800 p-4 space-y-3">
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">{r.title}</h3>
                <span className="text-xs text-gray-500">{day(r.periodStart)} – {day(r.periodEnd)} · published {day(r.publishedAt)}</span>
              </div>
              {r.summary && <p className="text-sm whitespace-pre-line">{r.summary}</p>}
              <Figures figures={r.figures} />
              {r.requests.length > 0 && (
                <ul className="text-sm space-y-1">
                  {r.requests.map((q: any) => (
                    <li key={q.id} className="flex flex-wrap gap-2 items-center">
                      <span className="font-semibold">{KIND_LABEL[q.kind]}</span> <Badge s={q.status} />
                      {q.ngoResponse && <span className="text-gray-600">— “{q.ngoResponse}”</span>}
                    </li>
                  ))}
                </ul>
              )}
              {canRequest && (
                <div className="flex flex-wrap gap-2">
                  {!has("RENEWAL") && <button className={`${btn} bg-emerald-600 text-white`} onClick={() => setAsking({ reportId: r.id, kind: "RENEWAL" })}>Renew this grant</button>}
                  {!has("NEXT_OPPORTUNITY") && <button className={`${btn} border border-emerald-600 text-emerald-700`} onClick={() => setAsking({ reportId: r.id, kind: "NEXT_OPPORTUNITY" })}>Ask about next opportunity</button>}
                </div>
              )}
              {asking && asking.reportId === r.id && (
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-950 space-y-2">
                  <p className="text-sm font-semibold">{KIND_LABEL[asking.kind]} request</p>
                  <textarea className={input} rows={2} placeholder="Message to the organisation (optional)" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
                  {asking.kind === "RENEWAL" && <input className={input} inputMode="decimal" placeholder="Indicative amount, ₹ (optional)" value={amount} onChange={(e) => setAmount(e.target.value)} />}
                  <div className="flex gap-2">
                    <button disabled={busy} className={`${btn} bg-emerald-600 text-white`} onClick={send}>{busy ? "Sending…" : "Send"}</button>
                    <button className={`${btn} border`} onClick={() => setAsking(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Donor: published impact stories ────────────────────────────────────────

function DonorStoriesPanel({ projectId }: { projectId: string }) {
  const [stories, setStories] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/donor/impact-stories?projectId=${encodeURIComponent(projectId)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load stories");
        setStories(j.stories);
      })
      .catch((e) => setError(e.message));
  }, [projectId]);
  return (
    <section className={card} aria-labelledby="donor-stories-h">
      <h2 id="donor-stories-h" className="text-lg font-bold text-gray-900 dark:text-white">Impact stories</h2>
      <p className="text-xs text-gray-500 mb-4">Reviewed before publication. Beneficiary quotes and photos appear only with their consent, and disappear if it is withdrawn.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!stories && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {stories && stories.length === 0 && <p className="text-sm text-gray-500 italic">No published stories yet.</p>}
      <ul className="space-y-4">
        {stories?.map((s) => (
          <li key={s.id} className="space-y-2">
            <h3 className="font-semibold">{s.title}</h3>
            <p className="text-sm whitespace-pre-line text-gray-700 dark:text-gray-300">{s.body}</p>
            {s.photoEvidenceIds.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {s.photoEvidenceIds.slice(0, 4).map((id: string) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={id} src={`/api/field/evidence/${id}/photo`} alt="Field photo shared with consent" className="h-24 w-32 object-cover rounded-lg" />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
