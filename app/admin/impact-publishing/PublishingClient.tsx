"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATE_LABEL } from "@/lib/impact-stories";

const card = "bg-white rounded-2xl border border-gray-200/80 p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
const btn = "px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN") : "—");

export default function PublishingClient({ reports, stories }: { reports: any[]; stories: any[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const decide = async (kind: "reports" | "stories", id: string, action: string) => {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/impact-${kind}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: notes[id] ?? "" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Decision failed");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const noteBox = (id: string, placeholder: string) => (
    <textarea
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
      rows={2}
      placeholder={placeholder}
      value={notes[id] ?? ""}
      onChange={(e) => setNotes({ ...notes, [id]: e.target.value })}
    />
  );

  return (
    <>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <section className={card}>
        <h2 className="text-lg font-bold mb-3">Funder reports awaiting review ({reports.length})</h2>
        {reports.length === 0 && <p className="text-sm text-gray-500 italic">Nothing to review.</p>}
        <ul className="space-y-4">
          {reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-gray-100 p-4 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{r.title}</span>
                <span className="text-xs text-gray-500">{r.orgName} · {day(r.periodStart)} – {day(r.periodEnd)} · submitted {day(r.submittedAt)}</span>
              </div>
              {r.summary && <p className="text-sm whitespace-pre-line">{r.summary}</p>}
              <ul className="text-sm">
                {r.figures.map((f: any) => (
                  <li key={f.claimId} className="flex justify-between">
                    <span>{f.metricName}</span>
                    {f.display.kind === "verified" ? <b>{f.display.value} {String(f.display.unit).toLowerCase()}</b> : <span className="text-amber-700 font-semibold" title={f.display.reason}>unverified</span>}
                  </li>
                ))}
              </ul>
              {noteBox(r.id, "Note (required to return)")}
              <div className="flex gap-2">
                <button disabled={busy === r.id} onClick={() => decide("reports", r.id, "PUBLISH")} className={`${btn} bg-emerald-600 text-white`}>Publish to funder</button>
                <button disabled={busy === r.id} onClick={() => decide("reports", r.id, "RETURN")} className={`${btn} border border-amber-600 text-amber-700`}>Return to NGO</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-lg font-bold mb-3">Impact stories awaiting review ({stories.length})</h2>
        <p className="text-xs text-gray-500 mb-3">Consent is re-checked when you publish; a story whose material lost consent is refused and sent back for regeneration.</p>
        {stories.length === 0 && <p className="text-sm text-gray-500 italic">Nothing to review.</p>}
        <ul className="space-y-4">
          {stories.map((s) => (
            <li key={s.id} className="rounded-xl border border-gray-100 p-4 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{s.title}</span>
                <span className="flex gap-2 items-center text-xs text-gray-500">
                  {s.orgName} · {s.variant === "DONOR" ? "Funder variant" : "Public variant"} · {s.generator === "TEMPLATE" ? <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">{TEMPLATE_LABEL}</span> : `AI (${s.generator.toLowerCase()})`}
                </span>
              </div>
              <p className="text-sm whitespace-pre-line">{s.body}</p>
              <p className="text-xs text-gray-500">{s.photoEvidenceIds.length} consented photo(s) · {s.excludedCount} item(s) excluded for consent</p>
              {noteBox(s.id, "Note (required to reject)")}
              <div className="flex gap-2">
                <button disabled={busy === s.id} onClick={() => decide("stories", s.id, "PUBLISH")} className={`${btn} bg-emerald-600 text-white`}>Publish</button>
                <button disabled={busy === s.id} onClick={() => decide("stories", s.id, "REJECT")} className={`${btn} border border-red-600 text-red-700`}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
