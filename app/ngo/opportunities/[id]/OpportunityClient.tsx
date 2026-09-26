"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NgoOpportunity } from "@/lib/requirements/opportunities";
import { formatBudgetRange, requirementApi } from "@/components/requirements/api";

interface MilestoneRow {
  title: string;
  amount: string;
  durationMonths: string;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-100 mt-0.5">{value}</dd>
    </div>
  );
}

export default function OpportunityClient({ opportunity }: { opportunity: NgoOpportunity }) {
  const router = useRouter();
  const { brief, open, invitedProjects, response } = opportunity;
  const editable = open && (!response || ["INTERESTED", "PROPOSAL_SUBMITTED"].includes(response.status));

  const [projectId, setProjectId] = useState(response?.projectId ?? invitedProjects[0]?.id ?? "");
  const [budget, setBudget] = useState(response?.proposedBudget?.toString() ?? "");
  const [duration, setDuration] = useState(response?.proposedDurationMonths?.toString() ?? brief.durationMonths?.toString() ?? "");
  const [plan, setPlan] = useState(response?.implementationPlan ?? "");
  const [outcomes, setOutcomes] = useState(response?.expectedOutcomes ?? "");
  const [compliance, setCompliance] = useState(response?.complianceNotes ?? "");
  const [milestones, setMilestones] = useState<MilestoneRow[]>(
    Array.isArray(response?.milestones)
      ? (response!.milestones as any[]).map((m) => ({ title: m.title ?? "", amount: m.amount?.toString() ?? "", durationMonths: m.durationMonths?.toString() ?? "" }))
      : []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requirementApi(`/api/opportunities/${brief.id}/interest`, {
        method: "POST",
        body: JSON.stringify({
          projectId,
          proposedBudget: budget || null,
          proposedDurationMonths: duration || null,
          implementationPlan: plan || null,
          expectedOutcomes: outcomes || null,
          complianceNotes: compliance || null,
          milestones: milestones
            .filter((m) => m.title.trim())
            .map((m) => ({ title: m.title, amount: m.amount || null, durationMonths: m.durationMonths || null })),
        }),
      });
      setNotice(budget && plan ? "Proposal submitted." : "Interest recorded. Add a budget and implementation plan to submit a full proposal.");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-500";

  return (
    <div className="min-h-screen bg-gray-950 py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <Link href="/ngo/opportunities" className="text-xs font-bold text-emerald-500 hover:underline">
          ← CSR Opportunities
        </Link>

        <div className="border border-gray-800 bg-gray-900/40 rounded-2xl p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">CSR Opportunity</p>
              <h1 className="text-2xl font-extrabold text-white mt-1">{brief.title}</h1>
            </div>
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${open ? "text-emerald-300 border-emerald-500/30" : "text-gray-400 border-gray-700"}`}>
              {open ? "Accepting responses" : "Closed"}
            </span>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Fact label="Sector" value={brief.sector ?? "—"} />
            <Fact label="Location" value={[brief.district, brief.state].filter(Boolean).join(", ") || "—"} />
            <Fact label="Funding range" value={formatBudgetRange(brief.budgetMin, brief.budgetMax)} />
            <Fact label="Duration" value={brief.durationMonths ? `${brief.durationMonths} months` : "—"} />
            <Fact label="Target beneficiaries" value={brief.expectedBeneficiaries ? `${brief.expectedBeneficiaries.toLocaleString("en-IN")}+` : "—"} />
            <Fact label="Reporting" value={brief.reportingCadence ?? "—"} />
            <Fact label="FCRA" value={brief.fcraRequired ? "Required" : "Not required"} />
            <Fact label="Registrations" value={[brief.requires80G && "80G", brief.requires12A && "12A"].filter(Boolean).join(", ") || "—"} />
            <Fact label="Timeline" value={brief.timeline ?? "—"} />
          </dl>
          {brief.keyOutcomes.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500">Key outcomes</p>
              <ul className="mt-1 text-sm text-gray-100 list-disc list-inside">
                {brief.keyOutcomes.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.requiredDocuments.length > 0 && (
            <p className="text-xs text-gray-400">Required documents: {brief.requiredDocuments.join(", ")}</p>
          )}
          <p className="text-[11px] text-gray-500">Your invited project(s): {invitedProjects.map((p) => p.title).join(", ")}</p>
        </div>

        {response && (
          <p className="text-sm text-gray-300 border border-gray-800 rounded-2xl px-5 py-3">
            Your response: <span className="font-bold text-white">{response.status.replace(/_/g, " ").toLowerCase()}</span> · submitted{" "}
            {new Date(response.submittedAt).toLocaleDateString("en-IN")}
          </p>
        )}
        {notice && <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-4 py-2">{notice}</p>}
        {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-2">{error}</p>}

        {editable && (
          <form id="respond" onSubmit={submit} className="border border-gray-800 bg-gray-900/40 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">{response ? "Update your response" : "Express interest / submit a proposal"}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="md:col-span-3 text-xs text-gray-400">
                Project
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${input} mt-1`}>
                  {invitedProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-400">
                Proposed budget (₹)
                <input type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} className={`${input} mt-1`} />
              </label>
              <label className="text-xs text-gray-400">
                Duration (months)
                <input type="number" min={1} max={120} value={duration} onChange={(e) => setDuration(e.target.value)} className={`${input} mt-1`} />
              </label>
            </div>
            <label className="block text-xs text-gray-400">
              Implementation plan
              <textarea rows={5} value={plan} onChange={(e) => setPlan(e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="block text-xs text-gray-400">
              Expected outcomes
              <textarea rows={3} value={outcomes} onChange={(e) => setOutcomes(e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="block text-xs text-gray-400">
              Compliance information (FCRA, 80G, 12A, audits…)
              <textarea rows={2} value={compliance} onChange={(e) => setCompliance(e.target.value)} className={`${input} mt-1`} />
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">Proposed milestones</p>
                <button
                  type="button"
                  onClick={() => setMilestones((m) => [...m, { title: "", amount: "", durationMonths: "" }])}
                  className="text-xs font-semibold text-emerald-400"
                >
                  + Add milestone
                </button>
              </div>
              {milestones.map((m, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input
                    placeholder={`Milestone ${i + 1}`}
                    value={m.title}
                    onChange={(e) => setMilestones((all) => all.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    className={`${input} col-span-6`}
                  />
                  <input
                    type="number"
                    placeholder="Amount ₹"
                    value={m.amount}
                    onChange={(e) => setMilestones((all) => all.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                    className={`${input} col-span-3`}
                  />
                  <input
                    type="number"
                    placeholder="Months"
                    value={m.durationMonths}
                    onChange={(e) => setMilestones((all) => all.map((x, j) => (j === i ? { ...x, durationMonths: e.target.value } : x)))}
                    className={`${input} col-span-2`}
                  />
                  <button type="button" onClick={() => setMilestones((all) => all.filter((_, j) => j !== i))} className="col-span-1 text-xs text-red-400">
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button type="submit" disabled={busy || !projectId} className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-sm font-bold disabled:opacity-50">
                {busy ? "Submitting…" : response ? "Update response" : "Submit"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
