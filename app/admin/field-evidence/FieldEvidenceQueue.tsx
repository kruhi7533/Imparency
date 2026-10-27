"use client";

import React, { useCallback, useEffect, useState } from "react";
import EvidenceReviewActions from "./EvidenceReviewActions";

type Flag = "DUPLICATE_IMAGE" | "GPS_MISMATCH" | "DUPLICATE_CHECK_UNAVAILABLE";

interface Item {
  id: string;
  status: string;
  orgName: string;
  taskTitle: string;
  taskStatus: string;
  projectTitle: string;
  projectLocation: string | null;
  photoUrl: string;
  photoMime: string;
  photoRenderable: boolean;
  flags: Flag[];
  duplicate: { text: string; tone: "neutral" | "warn" | "bad" } | null;
  locationStatus: string;
  distanceKm: number | null;
  accuracyM: number | null;
  note: string | null;
  containsPeople: boolean;
  consentToShare: boolean;
  consentWithdrawn: boolean;
  feedback: { rating: number | null; text: string | null } | null;
  capturedAt: string;
  syncedAt: string;
  offline: boolean;
  reviewNote: string | null;
  reviewedAt: string | null;
}

const STATUS_TABS = [
  { value: "PENDING_REVIEW", label: "Pending" },
  { value: "RESUBMIT_REQUESTED", label: "Returned to NGO" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

const FLAG_FILTERS = [
  { value: "", label: "Any" },
  { value: "any", label: "Flagged" },
  { value: "duplicate", label: "Duplicate image" },
  { value: "gps", label: "GPS mismatch" },
  { value: "clean", label: "No flags" },
];

const FLAG_TEXT: Record<Flag, string> = {
  DUPLICATE_IMAGE: "Duplicate image",
  GPS_MISMATCH: "GPS mismatch",
  DUPLICATE_CHECK_UNAVAILABLE: "Duplicate check unavailable",
};

export default function FieldEvidenceQueue() {
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [flag, setFlag] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null = null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ status });
        if (flag) qs.set("flag", flag);
        if (cursor) qs.set("cursor", cursor);
        const res = await fetch(`/api/admin/field-evidence?${qs}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setCounts(data.counts ?? {});
        setNextCursor(data.nextCursor);
      } catch (err: any) {
        setError(err.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [status, flag],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Field evidence</h1>
        <p className="text-sm text-gray-500">
          Automatic checks flag duplicate images and photos taken away from the project site; you decide. Donors see a photo
          only after approval — and, if it shows people, only with the beneficiary&apos;s consent to share.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Status">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={status === t.value}
            onClick={() => setStatus(t.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border ${
              status === t.value
                ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900"
                : "bg-white text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700"
            }`}
          >
            {t.label}
            {t.value !== "ALL" && counts[t.value] !== undefined ? ` · ${counts[t.value]}` : ""}
          </button>
        ))}
        <label className="ml-auto text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2">
          Flags
          <select
            value={flag}
            onChange={(e) => setFlag(e.target.value)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
          >
            {FLAG_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-red-50 text-red-800 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => load(null)} className="font-bold underline">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && <p className="text-sm text-gray-400 italic">Nothing here.</p>}

      {items.map((e) => (
        <div key={e.id} className="flex flex-col sm:flex-row gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
          {e.photoRenderable ? (
            <a href={e.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.photoUrl} alt={`Field evidence for ${e.taskTitle}`} className="w-full sm:w-48 h-48 rounded-xl object-cover bg-gray-100" />
            </a>
          ) : (
            <a href={e.photoUrl} className="w-full sm:w-48 h-48 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-700 dark:text-gray-300 underline">
              {e.photoMime.replace("image/", "").toUpperCase()} photo — download
            </a>
          )}
          <div className="flex-1 space-y-2 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-bold text-gray-900 dark:text-white">{e.taskTitle}</p>
                <p className="text-xs text-gray-500">
                  {e.orgName} · {e.projectTitle}
                  {e.projectLocation ? ` · ${e.projectLocation}` : ""}
                </p>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                {e.status.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {e.flags.map((f) => (
                <Chip key={f} bad={f !== "DUPLICATE_CHECK_UNAVAILABLE"} warn={f === "DUPLICATE_CHECK_UNAVAILABLE"}>
                  ⚑ {FLAG_TEXT[f]}
                </Chip>
              ))}
              <Chip bad={e.locationStatus === "MISMATCH"}>
                GPS {e.locationStatus.replace(/_/g, " ").toLowerCase()}
                {e.distanceKm !== null ? ` · ${e.distanceKm.toFixed(1)} km from site` : ""}
                {e.accuracyM !== null ? ` · ±${Math.round(e.accuracyM)} m` : ""}
              </Chip>
              {e.duplicate && <Chip bad={e.duplicate.tone === "bad"} warn={e.duplicate.tone === "warn"}>{e.duplicate.text}</Chip>}
              {e.offline && <Chip>Captured offline, synced later</Chip>}
              {!e.containsPeople ? (
                <Chip>No people in photo</Chip>
              ) : e.consentToShare ? (
                <Chip>Consent to share with funder</Chip>
              ) : (
                <Chip bad>{e.consentWithdrawn ? "Consent withdrawn" : "Shows people, no consent to share"} — donors will not see it</Chip>
              )}
            </div>
            {e.note && <p className="text-gray-700 dark:text-gray-300">{e.note}</p>}
            {e.feedback && (e.feedback.text || e.feedback.rating) && (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Beneficiary feedback{e.feedback.rating ? ` (${e.feedback.rating}/5)` : ""}: {e.feedback.text}
              </p>
            )}
            <p className="text-xs text-gray-400">
              Captured {new Date(e.capturedAt).toLocaleString("en-IN")} · synced {new Date(e.syncedAt).toLocaleString("en-IN")}
            </p>
            {e.reviewNote && <p className="text-xs text-gray-600 dark:text-gray-400">Review note: {e.reviewNote}</p>}
            {e.status === "PENDING_REVIEW" && (
              <EvidenceReviewActions
                evidenceId={e.id}
                flagged={e.flags.some((f) => f !== "DUPLICATE_CHECK_UNAVAILABLE")}
                onDone={() => load(null)}
              />
            )}
          </div>
        </div>
      ))}

      {loading && <p className="text-sm text-gray-500" role="status">Loading…</p>}
      {nextCursor && !loading && (
        <button onClick={() => load(nextCursor)} className="w-full py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-bold">
          Load more
        </button>
      )}
    </div>
  );
}

function Chip({ bad = false, warn = false, children }: { bad?: boolean; warn?: boolean; children: React.ReactNode }) {
  const tone = bad ? "bg-red-50 text-red-700" : warn ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-700";
  return <span className={`px-2 py-0.5 rounded-full font-bold ${tone}`}>{children}</span>;
}
