"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface FeedEvent {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  projectTitle: string;
  ngoName: string;
  mediaUrls: string[];
}

interface Subscription {
  projectId: string;
  projectTitle: string;
  channels: string[];
  frequency: string;
  active: boolean;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const TYPE_STYLE: Record<string, { label: string; classes: string }> = {
  PROOF_SUBMITTED: { label: "Proof submitted", classes: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" },
  MILESTONE_COMPLETED: { label: "✓ Verified milestone", classes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
  UPDATE_POSTED: { label: "Update", classes: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  FIELD_PHOTO: { label: "From the field", classes: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400" },
};

export default function ImpactFeedClient({
  events,
  subscriptions,
}: {
  events: FeedEvent[];
  subscriptions: Subscription[];
}) {
  const router = useRouter();
  const [subs, setSubs] = useState(subscriptions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showPrefs, setShowPrefs] = useState(false);

  async function updateSub(projectId: string, patch: Partial<Subscription>) {
    setBusy(projectId);
    setError("");
    try {
      const res = await fetch("/api/donor/impact-subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setSubs((prev) => prev.map((s) => (s.projectId === projectId ? { ...s, ...patch } : s)));
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Your Impact Feed</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Every verified update from the projects you support, in one place.
            </p>
          </div>
          <button
            onClick={() => setShowPrefs(!showPrefs)}
            className="px-4 py-2 text-sm font-bold rounded-xl border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            {showPrefs ? "Hide preferences" : "Preferences"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Preferences */}
        {showPrefs && (
          <div className="mt-6 space-y-3">
            {subs.map((s) => (
              <div key={s.projectId} className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-wrap items-center gap-3">
                <p className="flex-1 min-w-[180px] text-sm font-bold text-gray-900 dark:text-white">{s.projectTitle}</p>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={s.channels.includes("EMAIL")}
                    disabled={busy === s.projectId}
                    onChange={(e) =>
                      updateSub(s.projectId, {
                        channels: e.target.checked
                          ? Array.from(new Set([...s.channels, "EMAIL"]))
                          : s.channels.filter((c) => c !== "EMAIL"),
                      })
                    }
                  />
                  Email
                </label>
                <select
                  value={s.frequency}
                  disabled={busy === s.projectId}
                  onChange={(e) => updateSub(s.projectId, { frequency: e.target.value })}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-900 dark:text-white"
                >
                  <option value="INSTANT">Instant</option>
                  <option value="DAILY_DIGEST">Daily digest</option>
                  <option value="WEEKLY_DIGEST">Weekly digest</option>
                </select>
                <button
                  disabled={busy === s.projectId}
                  onClick={() => updateSub(s.projectId, { active: !s.active })}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    s.active
                      ? "border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                      : "bg-emerald-600 text-white hover:bg-emerald-700"
                  }`}
                >
                  {s.active ? "Unsubscribe" : "Resubscribe"}
                </button>
              </div>
            ))}
            {subs.length === 0 && (
              <p className="text-sm text-gray-400">No subscriptions yet — they're created automatically when you donate.</p>
            )}
          </div>
        )}

        {/* Feed */}
        <div className="mt-8 space-y-4">
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                No impact updates yet. When the projects you support make verified progress, it appears here.
              </p>
            </div>
          ) : (
            events.map((e) => {
              const style = TYPE_STYLE[e.type] ?? TYPE_STYLE.UPDATE_POSTED;
              return (
                <div key={e.id} className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${style.classes}`}>
                      {style.label}
                    </span>
                    <span className="text-xs text-gray-400">{fmt(e.createdAt)}</span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold text-gray-900 dark:text-white">{e.title}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {e.projectTitle}{e.ngoName ? ` · ${e.ngoName}` : ""}
                  </p>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{e.body}</p>
                  {e.mediaUrls.length > 0 && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {e.mediaUrls.slice(0, 4).map((url, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={url} alt="Impact evidence" className="h-24 w-24 object-cover rounded-lg border border-gray-100 dark:border-gray-800" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
