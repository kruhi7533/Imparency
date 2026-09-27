"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ProjectOption {
  id: string;
  title: string;
  description: string;
  causeCategory: string;
  targetAmount: number;
  raisedAmount: number;
  location: string;
  ngo: {
    id: string;
    orgName: string;
    panNumber: string;
    logo_url: string | null;
  };
  milestones: Array<{
    id: string;
    title: string;
    description: string;
    targetAmount: number;
    sequenceOrder: number;
  }>;
}

interface MilestoneInput {
  title: string;
  description: string;
  allocatedAmount: number;
  deliverables: string;
  dueDate: string;
  projectMilestoneId?: string;
}

/** An awarded (SELECTED) CSR requirement plus the selected NGO's proposal. */
interface RequirementOption {
  id: string;
  fileName: string;
  sector: string | null;
  state: string | null;
  reportingCadence: string | null;
  durationMonths: number | null;
  selectedProjectId: string | null;
  proposedBudget: number | null;
  proposedMilestones: Array<{ title: string; amount?: number | null; durationMonths?: number | null }>;
}

const DEFAULT_DELIVERABLES = "Impact verification report, field evidence, expense invoice";

function cadenceFromText(text: string | null): string | null {
  const t = (text || "").toLowerCase();
  if (t.includes("quarter")) return "QUARTERLY";
  if (t.includes("month")) return "MONTHLY";
  if (t.includes("milestone")) return "MILESTONE_BASED";
  return null;
}

/** Splits `total` across the project's milestones in proportion to their targets. */
function scaleMilestones(
  base: Array<{ id: string; title: string; description: string; targetAmount: number }>,
  total: number
): MilestoneInput[] {
  const baseSum = base.reduce((s, m) => s + m.targetAmount, 0);
  let allocated = 0;
  return base.map((m, i) => {
    const amount =
      i === base.length - 1
        ? Math.round((total - allocated) * 100) / 100
        : Math.round(baseSum > 0 ? (m.targetAmount / baseSum) * total : total / base.length);
    allocated += amount;
    return {
      title: m.title,
      description: m.description,
      allocatedAmount: amount,
      deliverables: DEFAULT_DELIVERABLES,
      dueDate: "",
      projectMilestoneId: m.id,
    };
  });
}

const CSR_SCHEDULE_VII_ITEMS = [
  "Item (i): Eradicating hunger, poverty & malnutrition, promoting healthcare",
  "Item (ii): Promoting education, special education & vocation skills",
  "Item (iii): Gender equality, empowering women, setting up hostels",
  "Item (iv): Ensuring environmental sustainability & ecological balance",
  "Item (v): Protection of national heritage, art and culture",
  "Item (vi): Measures for the benefit of armed forces veterans & war widows",
  "Item (vii): Training to promote rural sports & nationally recognized sports",
  "Item (viii): Contribution to Prime Minister's National Relief Fund / Clean Ganga",
  "Item (ix): Research and development projects in science, tech, medicine",
  "Item (x): Rural development projects & slum area development",
  "Item (xi): Disaster management, relief, rehabilitation and reconstruction",
];

const DEFAULT_TERMS = `1. GRANT PURPOSE & APPORTIONMENT:
The Grantor hereby commits the stipulated Grant Amount exclusively for the milestones and deliverables outlined in this Agreement. The NGO agrees to utilize all disbursed funds strictly in compliance with applicable statutory regulations, Section 135 (CSR Rules) of the Companies Act 2013, and Section 80G of the Income Tax Act 1961.

2. MILESTONE DISBURSEMENT GATE:
Disbursements shall be released on a progressive, milestone-by-milestone basis upon electronic submission and independent platform verification of required deliverables, geo-tagged photographic evidence, and financial utilization invoices.

3. AUDIT & INSPECTION COVENANTS:
The NGO shall maintain segregated accounting ledgers for the Grant. The Grantor and platform administrators reserve the right to conduct independent third-party monitoring, Theory of Change alignment assessments, and financial inspections upon 7 days prior written notice.

4. REPORTING & COMPLIANCE:
The NGO shall provide formal quarterly impact assessments, beneficiary enumeration logs, and an annual Utilization Certificate certified by a practicing Chartered Accountant.`;

const SECTOR_TO_SCHEDULE_VII: Array<[RegExp, number]> = [
  [/educat|school|literacy|skill|vocation/i, 1],
  [/health|hunger|nutrition|sanitation|drinking water/i, 0],
  [/women|gender|girl/i, 2],
  [/environment|climate|forest|ecolog/i, 3],
  [/heritage|\bart\b|culture/i, 4],
  [/veteran|armed forces/i, 5],
  [/sport/i, 6],
  [/research|science|technology/i, 8],
  [/rural|slum|village|livelihood/i, 9],
  [/disaster|relief|flood/i, 10],
];

function scheduleViiForSector(sector: string | null): string | null {
  if (!sector) return null;
  const hit = SECTOR_TO_SCHEDULE_VII.find(([re]) => re.test(sector));
  return hit ? CSR_SCHEDULE_VII_ITEMS[hit[1]] : null;
}

export default function NewContractClient({
  projects,
  requirements,
  initialProjectId,
  initialRequirementId,
  donorUser,
}: {
  projects: ProjectOption[];
  requirements: RequirementOption[];
  initialProjectId?: string;
  initialRequirementId?: string;
  donorUser: { name: string; email: string };
}) {
  const router = useRouter();

  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || (projects[0]?.id ?? ""));
  const [selectedRequirementId, setSelectedRequirementId] = useState(initialRequirementId || "");
  const [title, setTitle] = useState("");
  const [totalGrantAmount, setTotalGrantAmount] = useState<number>(0);
  const [csrCategory, setCsrCategory] = useState(CSR_SCHEDULE_VII_ITEMS[1]);
  const [reportingCadence, setReportingCadence] = useState("QUARTERLY");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [milestones, setMilestones] = useState<MilestoneInput[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When selected project changes, initialize title, grant amount, and milestones
  const handleProjectSelect = (projId: string) => {
    setSelectedProjectId(projId);
    const proj = projects.find((p) => p.id === projId);
    if (proj) {
      if (!title || title.startsWith("Grant Agreement for")) {
        setTitle(`Grant Agreement for ${proj.title}`);
      }
      setTotalGrantAmount(proj.targetAmount);
      setMilestones(
        proj.milestones.map((m) => ({
          title: m.title,
          description: m.description,
          allocatedAmount: m.targetAmount,
          deliverables: "Impact verification report, field evidence, expense invoice",
          dueDate: "",
          projectMilestoneId: m.id,
        }))
      );
    }
  };

  // Linking an awarded CSR requirement locks the project to the selected NGO's
  // project and prefills the agreement from the validated requirement + proposal.
  const applyRequirement = (reqId: string) => {
    setSelectedRequirementId(reqId);
    const r = requirements.find((x) => x.id === reqId);
    const proj = r?.selectedProjectId ? projects.find((p) => p.id === r.selectedProjectId) : undefined;
    if (!r || !proj) return;

    const total = r.proposedBudget ?? proj.targetAmount;
    setSelectedProjectId(proj.id);
    setTitle(`CSR Grant Agreement — ${[r.sector, r.state].filter(Boolean).join(", ") || proj.title}`);
    setTotalGrantAmount(total);
    const cadence = cadenceFromText(r.reportingCadence);
    if (cadence) setReportingCadence(cadence);
    const category = scheduleViiForSector(r.sector);
    if (category) setCsrCategory(category);

    const proposed = r.proposedMilestones.filter((m) => typeof m.amount === "number" && m.amount > 0);
    const proposedSum = proposed.reduce((s, m) => s + (m.amount as number), 0);
    if (proposed.length > 0 && Math.abs(proposedSum - total) < 0.01) {
      setMilestones(
        proposed.map((m) => ({
          title: m.title,
          description: "As proposed by the NGO in its response to the CSR opportunity.",
          allocatedAmount: m.amount as number,
          deliverables: DEFAULT_DELIVERABLES,
          dueDate: "",
        }))
      );
    } else {
      setMilestones(scaleMilestones(proj.milestones, total));
    }
  };

  // Initial load
  React.useEffect(() => {
    if (initialRequirementId && requirements.some((r) => r.id === initialRequirementId)) {
      applyRequirement(initialRequirementId);
    } else if (selectedProjectId) {
      handleProjectSelect(selectedProjectId);
    }
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const addMilestone = () => {
    setMilestones([
      ...milestones,
      {
        title: `Milestone ${milestones.length + 1}`,
        description: "",
        allocatedAmount: 0,
        deliverables: "Field verification, photo evidence",
        dueDate: "",
      },
    ]);
  };

  const removeMilestone = (idx: number) => {
    setMilestones(milestones.filter((_, i) => i !== idx));
  };

  const updateMilestone = (idx: number, field: keyof MilestoneInput, val: any) => {
    const updated = [...milestones];
    updated[idx] = { ...updated[idx], [field]: val };
    setMilestones(updated);
  };

  const milestoneTotal = milestones.reduce((sum, m) => sum + (Number(m.allocatedAmount) || 0), 0);
  const sumMismatch = Math.abs(milestoneTotal - Number(totalGrantAmount)) > 0.01;

  const handleSubmit = async (e: React.FormEvent, shouldPropose = false) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Please provide a title for this agreement.");
      return;
    }
    if (!totalGrantAmount || totalGrantAmount <= 0) {
      setError("Please specify a valid total grant amount.");
      return;
    }
    if (sumMismatch) {
      setError(
        `Milestone allocations sum (₹${milestoneTotal.toLocaleString("en-IN")}) must match total grant amount (₹${Number(
          totalGrantAmount
        ).toLocaleString("en-IN")}).`
      );
      return;
    }
    if (milestones.length === 0) {
      setError("Please add at least one milestone schedule.");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          requirementId: selectedRequirementId || null,
          title: title.trim(),
          totalGrantAmount: Number(totalGrantAmount),
          currency: "INR",
          startDate: startDate || null,
          endDate: endDate || null,
          csrScheduleViiCategory: csrCategory,
          reportingCadence,
          termsAndConditions: terms,
          milestones: milestones.map((m, idx) => ({
            title: m.title.trim(),
            description: m.description.trim(),
            allocatedAmount: Number(m.allocatedAmount),
            deliverables: m.deliverables
              ? m.deliverables.split(",").map((s) => s.trim()).filter(Boolean)
              : [],
            dueDate: m.dueDate || null,
            projectMilestoneId: m.projectMilestoneId || null,
            orderIndex: idx,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create contract");
      }

      const createdId = data.contract.id;

      if (shouldPropose) {
        await fetch(`/api/contracts/${createdId}/propose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "Initial agreement proposal submitted." }),
        });
      }

      router.push(`/donor/contracts/${createdId}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/donor/contracts" className="text-xs font-bold text-emerald-600 hover:underline">
            ← Back to Contracts
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">Draft Grant Agreement</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Link your institutional grant to an NGO Opportunity with milestone disbursement gates.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Select Opportunity / Project */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">1. Select Target Opportunity</h2>
        
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              Opportunity / NGO Project
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => handleProjectSelect(e.target.value)}
              disabled={!!selectedRequirementId}
              title={selectedRequirementId ? "Locked to the NGO project selected for the linked CSR requirement" : undefined}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.ngo.orgName}) — Target: ₹{p.targetAmount.toLocaleString("en-IN")}
                </option>
              ))}
            </select>
          </div>

          {selectedProject && (
            <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-base flex-shrink-0">
                {selectedProject.ngo.orgName.charAt(0)}
              </div>
              <div className="space-y-1 text-xs">
                <p className="font-bold text-gray-900 dark:text-white text-sm">{selectedProject.title}</p>
                <p className="text-gray-600 dark:text-gray-300">{selectedProject.description}</p>
                <p className="text-emerald-700 dark:text-emerald-400 font-medium">
                  Partner NGO: <span className="font-bold">{selectedProject.ngo.orgName}</span> · Location: {selectedProject.location}
                </p>
              </div>
            </div>
          )}

          {requirements.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                Link to Awarded CSR Requirement (Optional)
              </label>
              <select
                value={selectedRequirementId}
                onChange={(e) => (e.target.value ? applyRequirement(e.target.value) : setSelectedRequirementId(""))}
                className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">None (Independent Agreement)</option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fileName}
                    {r.sector ? ` — ${r.sector}${r.state ? `, ${r.state}` : ""}` : ""}
                  </option>
                ))}
              </select>
              {selectedRequirementId && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Prefilled from the validated requirement and the selected NGO&apos;s proposal. The project is locked to the
                  selected NGO; linking marks the requirement as contracted.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Grant Parameters & Compliance */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">2. Grant Parameters & CSR Classification</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Agreement Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. FY2026 CSR Grant Agreement for Rural Literacy Campaign"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Total Grant Amount (₹ INR)</label>
            <input
              type="number"
              value={totalGrantAmount || ""}
              onChange={(e) => setTotalGrantAmount(parseFloat(e.target.value) || 0)}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Reporting Cadence</label>
            <select
              value={reportingCadence}
              onChange={(e) => setReportingCadence(e.target.value)}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="MILESTONE_BASED">Milestone Based</option>
              <option value="MONTHLY">Monthly Progress</option>
              <option value="QUARTERLY">Quarterly Review</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              CSR Schedule VII Classification (Companies Act 2013)
            </label>
            <select
              value={csrCategory}
              onChange={(e) => setCsrCategory(e.target.value)}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {CSR_SCHEDULE_VII_ITEMS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Grant Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Grant End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Step 3: Milestone Disbursement Gates */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">3. Milestone Disbursement Schedule</h2>
            <p className="text-xs text-gray-500 mt-0.5">Funds are released progressively as each milestone proof is verified.</p>
          </div>
          <button
            type="button"
            onClick={addMilestone}
            className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 text-xs font-bold rounded-lg transition"
          >
            + Add Milestone
          </button>
        </div>

        <div className="space-y-4">
          {milestones.map((m, idx) => (
            <div key={idx} className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase text-emerald-600">Milestone {idx + 1}</span>
                {milestones.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMilestone(idx)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold text-gray-500 mb-0.5">Milestone Title</label>
                  <input
                    type="text"
                    value={m.title}
                    onChange={(e) => updateMilestone(idx, "title", e.target.value)}
                    className="w-full text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-0.5">Disbursement Amount (₹)</label>
                  <input
                    type="number"
                    value={m.allocatedAmount || ""}
                    onChange={(e) => updateMilestone(idx, "allocatedAmount", parseFloat(e.target.value) || 0)}
                    className="w-full text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white font-semibold"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold text-gray-500 mb-0.5">Required Deliverables (comma-separated)</label>
                  <input
                    type="text"
                    value={m.deliverables}
                    onChange={(e) => updateMilestone(idx, "deliverables", e.target.value)}
                    className="w-full text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white"
                    placeholder="e.g. Geo-tagged photos, beneficiary list, CA invoice"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-0.5">Target Completion Date</label>
                  <input
                    type="date"
                    value={m.dueDate}
                    onChange={(e) => updateMilestone(idx, "dueDate", e.target.value)}
                    className="w-full text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Milestone sum validator banner */}
        <div className={`p-3 rounded-xl text-xs font-bold flex items-center justify-between ${
          sumMismatch ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
        }`}>
          <span>Allocated: ₹{milestoneTotal.toLocaleString("en-IN")} / Total Grant: ₹{Number(totalGrantAmount).toLocaleString("en-IN")}</span>
          <span>{sumMismatch ? "⚠ Allocations do not balance" : "✓ Perfect Match"}</span>
        </div>
      </div>

      {/* Step 4: Terms & Conditions */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-3">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">4. Legal & Operational Terms</h2>
        <textarea
          rows={8}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          className="w-full text-xs font-mono bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-4">
        <Link
          href="/donor/contracts"
          className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          Cancel
        </Link>
        <button
          type="button"
          disabled={loading || sumMismatch}
          onClick={(e) => handleSubmit(e, false)}
          className="px-5 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-gray-800 dark:text-gray-200 text-sm font-semibold transition disabled:opacity-50"
        >
          Save Draft
        </button>
        <button
          type="button"
          disabled={loading || sumMismatch}
          onClick={(e) => handleSubmit(e, true)}
          className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:opacity-50"
        >
          {loading ? "Processing…" : "Propose Agreement to NGO →"}
        </button>
      </div>
    </form>
  );
}
