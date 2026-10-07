"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** Week 7: assign field tasks for this project and see what came back. */

export interface PanelTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  assigneeName: string;
  milestoneTitle: string | null;
  evidence: Array<{
    id: string;
    status: string;
    note: string | null;
    locationStatus: string;
    distanceKm: number | null;
    duplicate: boolean;
    capturedAt: string;
    syncedAt: string;
    reviewNote: string | null;
    consent: null | { consentToRecord: boolean; consentToSharePhoto: boolean; withdrawn: boolean };
  }>;
}

const EVIDENCE_BADGE: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  RESUBMIT_REQUESTED: "bg-orange-100 text-orange-700",
  REJECTED: "bg-red-100 text-red-700",
};

export default function FieldTasksPanel({
  projectId,
  canManage,
  team,
  milestones,
  tasks,
}: {
  projectId: string;
  canManage: boolean;
  team: Array<{ userId: string; name: string; role: string }>;
  milestones: Array<{ id: string; title: string }>;
  tasks: PanelTask[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", instructions: "", assignedToId: team[0]?.userId ?? "", milestoneId: "", dueDate: "" });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ngo/field-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, projectId, milestoneId: form.milestoneId || null, dueDate: form.dueDate || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to assign task");
      setShowForm(false);
      setForm((f) => ({ ...f, title: "", instructions: "" }));
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2";

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Field tasks & evidence</h2>
          <p className="text-xs text-gray-500">
            Field staff capture photo + GPS + note in the{" "}
            <Link href="/ngo/field" className="text-emerald-600 underline">
              field app
            </Link>
            , which works offline.
          </p>
        </div>
        {canManage && !showForm && (
          <button onClick={() => setShowForm(true)} className="self-start px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl">
            + Assign field task
          </button>
        )}
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {showForm && (
        <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/40">
          <label className="text-xs font-bold sm:col-span-2">
            Task
            <input required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Photograph the completed classroom" className={input} />
          </label>
          <label className="text-xs font-bold">
            Assign to
            <select required value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })} className={input}>
              {team.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.role.replace("_", " ").toLowerCase()})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Milestone
            <select value={form.milestoneId} onChange={(e) => setForm({ ...form, milestoneId: e.target.value })} className={input}>
              <option value="">Not milestone-specific</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Due date
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={input} />
          </label>
          <label className="text-xs font-bold sm:col-span-2">
            Instructions
            <textarea rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className={input} />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-xs font-bold text-gray-600">
              Cancel
            </button>
            <button disabled={busy} className="px-5 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl disabled:opacity-50">
              {busy ? "Assigning…" : "Assign"}
            </button>
          </div>
        </form>
      )}

      {tasks.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No field tasks for this project yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {tasks.map((t) => (
            <li key={t.id} className="py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{t.title}</p>
                  <p className="text-xs text-gray-500">
                    {t.assigneeName}
                    {t.milestoneTitle ? ` · ${t.milestoneTitle}` : ""}
                    {t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString("en-IN")}` : ""}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-gray-100 text-gray-700">{t.status}</span>
              </div>
              {t.evidence.map((e) => (
                <div key={e.id} className="flex gap-3 p-2 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/field/evidence/${e.id}/photo`} alt="Field evidence" className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
                  <div className="text-xs space-y-1 min-w-0">
                    <div className="flex flex-wrap gap-1">
                      <span className={`px-2 py-0.5 rounded-full font-bold ${EVIDENCE_BADGE[e.status] ?? ""}`}>{e.status.replace("_", " ")}</span>
                      <span className={`px-2 py-0.5 rounded-full font-bold ${e.locationStatus === "MATCH" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        GPS {e.locationStatus.replace(/_/g, " ").toLowerCase()}
                        {e.distanceKm !== null ? ` (${e.distanceKm.toFixed(1)} km)` : ""}
                      </span>
                      {e.duplicate && <span className="px-2 py-0.5 rounded-full font-bold bg-red-50 text-red-700">Duplicate photo</span>}
                      {new Date(e.syncedAt).getTime() - new Date(e.capturedAt).getTime() > 10 * 60_000 && (
                        <span className="px-2 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700">Captured offline</span>
                      )}
                      {e.consent && (
                        <span className={`px-2 py-0.5 rounded-full font-bold ${e.consent.consentToSharePhoto && !e.consent.withdrawn ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                          {e.consent.withdrawn ? "Consent withdrawn" : e.consent.consentToSharePhoto ? "Consent: share with funder" : "Consent: do not share"}
                        </span>
                      )}
                    </div>
                    {e.note && <p className="text-gray-700 dark:text-gray-300">{e.note}</p>}
                    {e.reviewNote && <p className="text-orange-700">Reviewer: {e.reviewNote}</p>}
                    <p className="text-gray-400">Captured {new Date(e.capturedAt).toLocaleString("en-IN")}</p>
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
