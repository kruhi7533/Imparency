"use client";

import { useEffect, useState } from "react";

interface InitiativeRow {
  id: string;
  organizerName: string;
  organizerType: string;
  location: string;
  requiredFunds: number;
  raisedAmount: number;
  status: string;
  createdAt: string;
  crisisEvent: { title: string; slug: string };
  submittedBy: { name: string; email: string };
}

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400",
  UNDER_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  PUBLISHED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

export default function AdminInitiativesPage() {
  const [initiatives, setInitiatives] = useState<InitiativeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("SUBMITTED");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/initiatives${filter === "ALL" ? "" : `?status=${filter}`}`)
      .then((r) => r.json())
      .then((d) => setInitiatives(d.initiatives || []))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Relief Initiative Verification</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Individual and informal-group relief efforts, submitted for crisis events. Verify bank proof against declared account details before publishing.
          </p>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {["SUBMITTED", "UNDER_REVIEW", "PUBLISHED", "REJECTED", "ALL"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                filter === f
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800"
              }`}
            >
              {f.replace("_", " ")}
            </button>
          ))}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-400 uppercase tracking-wide">
                <th className="py-3 px-4">Organizer</th>
                <th className="py-3 px-4">Crisis</th>
                <th className="py-3 px-4">Funds</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-10 text-center text-gray-400 text-sm">Loading…</td></tr>
              ) : initiatives.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-gray-400 text-sm">No initiatives match this filter.</td></tr>
              ) : (
                initiatives.map((i) => (
                  <tr key={i.id} className="border-b border-gray-50 dark:border-gray-850 last:border-0">
                    <td className="py-3 px-4">
                      <div className="font-bold text-gray-900 dark:text-white">{i.organizerName}</div>
                      <div className="text-xs text-gray-400">{i.organizerType} · {i.location}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">{i.crisisEvent.title}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-gray-900 dark:text-white">₹{i.requiredFunds.toLocaleString("en-IN")}</div>
                      <div className="text-[10px] text-gray-400">₹{i.raisedAmount.toLocaleString("en-IN")} raised</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[i.status]}`}>{i.status.replace("_", " ")}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <a href={`/admin/initiatives/${i.id}`} className="text-emerald-600 hover:text-emerald-700 font-bold text-xs">Review →</a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
