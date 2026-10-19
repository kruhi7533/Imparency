"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { matchingReadiness, type ReadinessInput } from "@/lib/project-readiness";
import { LEGACY_PROJECT_CADENCES, REPORTING_CADENCES } from "@/lib/requirements/form-options";

/**
 * The project's beneficiary cohort and matching profile, with the "ready for
 * matching" checklist. Saved through its own endpoint so it never sends a live
 * project back to approval. Cause and state come from the main project form.
 */
export default function MatchingProfilePanel({
  projectId,
  initial,
  canEdit,
}: {
  projectId: string;
  initial: ReadinessInput;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [beneficiaries, setBeneficiaries] = useState(initial.expectedBeneficiaries?.toString() ?? "");
  const [group, setGroup] = useState(initial.beneficiaryGroup ?? "");
  const [duration, setDuration] = useState(initial.durationMonths?.toString() ?? "");
  const [kpis, setKpis] = useState((initial.primaryKPIs ?? []).join("\n"));
  const [cadence, setCadence] = useState(initial.reportingCadence ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  const readiness = matchingReadiness({
    ...initial,
    expectedBeneficiaries: beneficiaries ? Number(beneficiaries) : null,
    beneficiaryGroup: group,
    durationMonths: duration ? Number(duration) : null,
    primaryKPIs: kpis.split("\n"),
    reportingCadence: cadence,
  });

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/ngo/projects/${projectId}/matching-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedBeneficiaries: beneficiaries || null,
          beneficiaryGroup: group,
          durationMonths: duration || null,
          primaryKPIs: kpis.split("\n").map((k) => k.trim()).filter(Boolean),
          reportingCadence: cadence || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save.");
      setSaved(true);
      setEditing(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white";

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Beneficiary cohort & matching profile</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            What CSR matching compares your project on. Saving here does not send the project back for approval.
          </p>
        </div>
        <span
          className={`px-3 py-0.5 rounded-full text-xs font-extrabold ${
            readiness.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {readiness.ready ? "Ready for matching" : `${readiness.missing.length} to complete`}
        </span>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
        {readiness.items.map((i) => (
          <li key={i.key} className={i.done ? "text-emerald-700 dark:text-emerald-400" : i.required ? "text-amber-700 dark:text-amber-400" : "text-gray-500"}>
            {i.done ? "✓" : i.required ? "○" : "·"} {i.label}
            {!i.required && !i.done ? " (optional — sharpens the match)" : ""}
          </li>
        ))}
      </ul>
      {!readiness.ready && (readiness.missing.includes("Cause / sector") || readiness.missing.includes("State the project operates in")) && (
        <p className="text-[11px] text-gray-500">Cause and state are set in the main project editor.</p>
      )}

      {canEdit && !editing && (
        <button type="button" onClick={() => setEditing(true)} className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">
          Edit cohort & matching profile
        </button>
      )}

      {canEdit && editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">
            Beneficiary cohort size (people)
            <input className={`${input} mt-1`} inputMode="numeric" value={beneficiaries} onChange={(e) => setBeneficiaries(e.target.value)} placeholder="e.g. 500" />
          </label>
          <label className="text-xs text-gray-500">
            Duration (months)
            <input className={`${input} mt-1`} inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 12" />
          </label>
          <label className="text-xs text-gray-500 md:col-span-2">
            Who the beneficiaries are
            <input
              className={`${input} mt-1`}
              maxLength={200}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="e.g. Girls aged 14–18 in government schools of Nashik district"
            />
          </label>
          <label className="text-xs text-gray-500">
            Outcome KPIs (one per line)
            <textarea className={`${input} mt-1`} rows={3} value={kpis} onChange={(e) => setKpis(e.target.value)} placeholder={"Students trained in digital skills\nAttendance rate"} />
          </label>
          <label className="text-xs text-gray-500">
            Reporting cadence
            <select className={`${input} mt-1`} value={cadence} onChange={(e) => setCadence(e.target.value)}>
              <option value="">Not specified</option>
              {/* Keep a value saved by the new-project form selectable, so saving never wipes it. */}
              {initial.reportingCadence && !REPORTING_CADENCES.includes(initial.reportingCadence) && (
                <option value={initial.reportingCadence}>{LEGACY_PROJECT_CADENCES[initial.reportingCadence] ?? initial.reportingCadence}</option>
              )}
              {REPORTING_CADENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] px-4 py-2 rounded-lg text-xs text-gray-600">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={save} className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50">
              {busy ? "Saving…" : "Save matching profile"}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <p role="status" aria-live="polite" className="text-xs text-emerald-700">{saved ? "Saved. New matching runs will use it." : ""}</p>
    </section>
  );
}
