"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TEMPLATE_LABEL } from "@/lib/impact-stories";

const card = "bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 shadow-sm";
const btn = "px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50";
const input = "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm";
const KIND_LABEL: Record<string, string> = { RENEWAL: "Renewal", NEXT_OPPORTUNITY: "Next opportunity" };
const BADGE: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-700",
  ACCEPTED: "bg-emerald-100 text-emerald-700",
  DECLINED: "bg-red-100 text-red-700",
  DRAFT: "bg-gray-100 text-gray-700",
  IN_REVIEW: "bg-blue-100 text-blue-700",
  PUBLISHED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  NEEDS_REGENERATION: "bg-amber-100 text-amber-800",
};
const Badge = ({ s }: { s: string }) => <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${BADGE[s] ?? "bg-gray-100"}`}>{s.replace(/_/g, " ")}</span>;

export default function ReportingClient({
  projects,
  contracts,
}: {
  projects: { id: string; title: string }[];
  contracts: { id: string; title: string; contractNumber: string; projectId: string; status: string }[];
}) {
  return (
    <>
      <section className={card}>
        <h2 className="text-lg font-bold mb-1">Contracts</h2>
        <p className="text-xs text-gray-500 mb-3">Write impact reports and record expenses on each contract&apos;s page.</p>
        {contracts.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No active or completed contracts.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {contracts.map((c) => (
              <li key={c.id}>
                <Link className="text-emerald-700 underline" href={`/ngo/contracts/${c.id}`}>{c.contractNumber} — {c.title}</Link> <span className="text-xs text-gray-500">({c.status.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <RenewalInbox />
      <StoriesPanel projects={projects} contracts={contracts} />
    </>
  );
}

function RenewalInbox() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [canRespond, setCanRespond] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ngo/renewal-requests");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load requests");
      setRows(j.requests);
      setCanRespond(j.canRespond);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const answer = async (id: string, action: "ACCEPT" | "DECLINE") => {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/ngo/renewal-requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, response: text[id] ?? "" }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to answer");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={card} aria-labelledby="renewal-h">
      <h2 id="renewal-h" className="text-lg font-bold mb-1">Funder requests</h2>
      <p className="text-xs text-gray-500 mb-3">Renewal and next-opportunity requests funders sent from your published impact reports.</p>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {!rows && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-gray-500 italic">No requests yet.</p>}
      <ul className="space-y-3">
        {rows?.map((r) => (
          <li key={r.id} className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-2">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span><b>{KIND_LABEL[r.kind]}</b> on <Link className="underline" href={`/ngo/contracts/${r.contract.id}`}>{r.contract.contractNumber || r.contract.title}</Link> · report “{r.report.title}”</span>
              <Badge s={r.status} />
            </div>
            {r.message && <p className="text-sm text-gray-700 dark:text-gray-300">“{r.message}”</p>}
            {r.proposedAmount && <p className="text-xs text-gray-600">Indicative amount: ₹{Number(r.proposedAmount).toLocaleString("en-IN")}</p>}
            {r.ngoResponse && <p className="text-xs text-gray-600">Your response: {r.ngoResponse}</p>}
            {r.status === "OPEN" && canRespond && (
              <div className="space-y-2">
                <textarea className={input} rows={2} placeholder="Your response (required to decline)" value={text[r.id] ?? ""} onChange={(e) => setText({ ...text, [r.id]: e.target.value })} />
                <div className="flex gap-2">
                  <button disabled={busy === r.id} onClick={() => answer(r.id, "ACCEPT")} className={`${btn} bg-emerald-600 text-white`}>Accept</button>
                  <button disabled={busy === r.id} onClick={() => answer(r.id, "DECLINE")} className={`${btn} border border-red-600 text-red-700`}>Decline</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StoriesPanel({ projects, contracts }: { projects: { id: string; title: string }[]; contracts: { id: string; projectId: string; contractNumber: string }[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [material, setMaterial] = useState<any>(null);
  const [stories, setStories] = useState<any[] | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStories = useCallback(async () => {
    const res = await fetch("/api/ngo/impact-stories");
    const j = await res.json();
    if (res.ok) {
      setStories(j.stories);
      setCanGenerate(j.canGenerate);
    } else setError(j.error || "Failed to load stories");
  }, []);
  const loadMaterial = useCallback(async () => {
    if (!projectId) return;
    setMaterial(null);
    const res = await fetch(`/api/ngo/impact-stories/material?projectId=${encodeURIComponent(projectId)}`);
    const j = await res.json();
    if (res.ok) setMaterial(j);
    else setError(j.error || "Failed to load beneficiary material");
  }, [projectId]);
  useEffect(() => {
    loadStories();
  }, [loadStories]);
  useEffect(() => {
    loadMaterial();
  }, [loadMaterial]);

  const setConsent = async (feedbackId: string, scope: string) => {
    setError("");
    const res = await fetch(`/api/field/feedback/${feedbackId}/story-consent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
    const j = await res.json();
    if (!res.ok) setError(j.error || "Failed to record consent");
    await loadMaterial();
  };

  const generate = async (variant: "DONOR" | "PUBLIC") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const contractId = contracts.find((c) => c.projectId === projectId)?.id;
      const res = await fetch("/api/ngo/impact-stories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, variant, contractId }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to generate");
      if (j.story.generator === "TEMPLATE") {
        setNotice(j.fallbackReason === "AI_PROVIDER_UNAVAILABLE" ? "No AI model is configured, so a template draft was created. Review and edit it before submitting." : "The AI draft was unavailable or broke a rule, so a template draft was created.");
      }
      await loadStories();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (id: string) => {
    setError("");
    const res = await fetch(`/api/ngo/impact-stories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SUBMIT" }) });
    const j = await res.json();
    if (!res.ok) setError(j.error || "Failed to submit");
    await loadStories();
  };

  return (
    <section className={card} aria-labelledby="stories-h">
      <h2 id="stories-h" className="text-lg font-bold mb-1">Impact stories</h2>
      <p className="text-xs text-gray-500 mb-4">
        Beneficiary quotes and photos are included only with the right consent — filtered before anything is generated. No names are ever used. An admin reviews every story before it is published.
      </p>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {notice && <p className="text-sm text-amber-800 bg-amber-50 rounded p-2 mb-2">{notice}</p>}
      {projects.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No projects yet.</p>
      ) : (
        <div className="space-y-4">
          <label className="text-xs font-semibold block">Project
            <select className={input} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          {!material ? <p className="text-sm text-gray-500">Loading beneficiary material…</p> : (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">
                Donor story would use {material.summary.donor.quotes} quote(s), {material.summary.donor.photos} photo(s). Public story would use {material.summary.public.quotes} quote(s), {material.summary.public.photos} photo(s).
              </p>
              {material.items.length === 0 ? <p className="text-sm text-gray-500 italic">No beneficiary feedback captured on this project.</p> : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  {material.items.map((it: any) => (
                    <li key={it.feedbackId} className="py-2 flex flex-wrap gap-3 justify-between items-center">
                      <span className="max-w-md">{it.withdrawn ? <i className="text-gray-500">Consent withdrawn — content erased</i> : it.preview ? `“${it.preview}”` : <i className="text-gray-500">No text</i>} <span className="text-xs text-gray-500">({it.evidenceStatus?.toLowerCase().replace(/_/g, " ")})</span></span>
                      {!it.withdrawn && it.consentToRecord ? (
                        <label className="text-xs">Story consent{" "}
                          <select className="border rounded px-1 py-0.5" value={it.storyConsent} onChange={(e) => setConsent(it.feedbackId, e.target.value)} disabled={!canGenerate}>
                            <option value="NONE">None</option>
                            <option value="DONOR_ONLY">Funder only</option>
                            <option value="PUBLIC">Public</option>
                          </select>
                        </label>
                      ) : <span className="text-xs text-gray-500">{it.withdrawn ? "excluded" : "no consent to record"}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {canGenerate && (
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => generate("DONOR")} className={`${btn} bg-emerald-600 text-white`}>{busy ? "Generating…" : "Generate funder story"}</button>
              <button disabled={busy} onClick={() => generate("PUBLIC")} className={`${btn} border border-emerald-600 text-emerald-700`}>Generate public story</button>
            </div>
          )}
        </div>
      )}

      <h3 className="mt-6 mb-2 text-sm font-bold">Your stories</h3>
      {!stories ? <p className="text-sm text-gray-500">Loading…</p> : stories.length === 0 ? <p className="text-sm text-gray-500 italic">No stories yet.</p> : (
        <ul className="space-y-3">
          {stories.map((s) => (
            <li key={s.id} className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{s.title}</span>
                <span className="flex gap-2 items-center text-xs">
                  <span className="text-gray-500">{s.variant === "DONOR" ? "Funder" : "Public"}</span>
                  {s.generator === "TEMPLATE" && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">{TEMPLATE_LABEL}</span>}
                  <Badge s={s.status} />
                </span>
              </div>
              <p className="text-sm whitespace-pre-line text-gray-700 dark:text-gray-300">{s.body}</p>
              {s.excludedCount > 0 && <p className="text-xs text-gray-500">{s.excludedCount} beneficiary item(s) excluded for lack of consent.</p>}
              {s.regenerationReason && <p className="text-xs text-amber-800">{s.regenerationReason}</p>}
              {s.reviewNote && <p className="text-xs text-gray-600">Reviewer: {s.reviewNote}</p>}
              {s.status === "DRAFT" && canGenerate && <button onClick={() => submit(s.id)} className={`${btn} bg-blue-600 text-white`}>Submit for review</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
