"use client";

import { useState } from "react";

const CATEGORIES = [
  { value: "FUND_MISUSE", label: "Money is not being used as promised" },
  { value: "SERVICE_FAILURE", label: "Work was reported but not delivered" },
  { value: "SAFEGUARDING", label: "Someone's safety or wellbeing" },
  { value: "DATA_PRIVACY", label: "How my personal data was handled" },
  { value: "OTHER", label: "Something else" },
] as const;

/**
 * Deliberately minimal.
 *
 * This is the API's companion, not a designed intake experience — the polished
 * public form belongs to whoever owns the public surface (see the boundary
 * note in docs/WEEK7-BLUEPRINT.md). What it does do correctly: it never asks
 * for a severity, it tells the reporter plainly who can and cannot see the
 * report, and it does not pretend to be anonymous.
 */
export default function ReportConcernForm({
  organisations,
}: {
  organisations: { id: string; orgName: string }[];
}) {
  const [ngoId, setNgoId] = useState("");
  const [category, setCategory] = useState<string>("OTHER");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/grievances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ngoId, category, subject: subject.trim(), body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not file this report");
      setFiled(data.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (filed) {
    return (
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/20 p-6">
        <h2 className="text-lg font-bold text-emerald-800 dark:text-emerald-300">Report filed</h2>
        <p className="mt-2 text-sm text-emerald-900/80 dark:text-emerald-200/80">
          The platform team will review it. Nobody at the organisation you reported can see this
          report or that you filed it.
        </p>
        <p className="mt-3 font-mono text-xs text-emerald-700 dark:text-emerald-400">
          Reference: {filed}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="block text-sm font-bold text-gray-900 dark:text-white">
          Which organisation is this about?
        </label>
        <select
          required
          value={ngoId}
          onChange={(e) => setNgoId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
        >
          <option value="">Choose an organisation…</option>
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.orgName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-900 dark:text-white">
          What kind of concern is it?
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {/* No severity field, on purpose: see the component comment. */}
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-900 dark:text-white">
          Summarise it in one line
        </label>
        <input
          required
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Milestone reported complete but no work was done"
          className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-900 dark:text-white">
          What happened?
        </label>
        <textarea
          required
          rows={7}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Dates, places and what you saw are the most useful things you can include."
          className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy || !ngoId || !subject.trim() || !body.trim()}
        className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "Filing…" : "File this report"}
      </button>
    </form>
  );
}
