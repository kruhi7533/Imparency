"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import UpdateFeedback from "@/components/donor/UpdateFeedback";

interface FeedEvent {
  id: string;
  projectId: string;
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
  PROOF_SUBMITTED: { label: "Proof submitted", classes: "bg-blue-50 text-blue-700 ring-1 ring-blue-200" },
  MILESTONE_COMPLETED: { label: "✓ Verified milestone", classes: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  UPDATE_POSTED: { label: "Update", classes: "bg-gray-50 text-gray-600 ring-1 ring-gray-200" },
  FIELD_PHOTO: { label: "From the field", classes: "bg-violet-50 text-violet-700 ring-1 ring-violet-200" },
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
    <div className="py-8 sm:py-10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">Your Impact Feed</h1>
            <p className="mt-1 text-sm text-gray-600">
              Every verified update from the projects you support, in one place.
            </p>
          </div>
          <button
            onClick={() => setShowPrefs(!showPrefs)}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 transition"
          >
            {showPrefs ? "Hide preferences" : "Preferences"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* Preferences */}
        {showPrefs && (
          <div className="mt-6 space-y-3">
            {subs.map((s) => (
              <div key={s.projectId} className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-4 flex flex-wrap items-center gap-3">
                <p className="flex-1 min-w-[180px] text-sm font-bold text-gray-900">{s.projectTitle}</p>
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
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
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20"
                >
                  <option value="INSTANT">Instant</option>
                  <option value="DAILY_DIGEST">Daily digest</option>
                  <option value="WEEKLY_DIGEST">Weekly digest</option>
                </select>
                <button
                  disabled={busy === s.projectId}
                  onClick={() => updateSub(s.projectId, { active: !s.active })}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    s.active
                      ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      : "bg-trust-600 text-white hover:bg-trust-700"
                  }`}
                >
                  {s.active ? "Unsubscribe" : "Resubscribe"}
                </button>
              </div>
            ))}
            {subs.length === 0 && (
              <p className="text-sm text-gray-500">No subscriptions yet — they're created automatically when you donate.</p>
            )}
          </div>
        )}

        {/* Feed */}
        <div className="mt-8 space-y-4">
          {events.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
              <p className="text-sm font-medium text-gray-500">
                No impact updates yet. When the projects you support make verified progress, it appears here.
              </p>
            </div>
          ) : (
            events.map((e) => {
              const style = TYPE_STYLE[e.type] ?? TYPE_STYLE.UPDATE_POSTED;
              return (
                <div key={e.id} className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${style.classes}`}>
                      {style.label}
                    </span>
                    <span className="text-xs text-gray-500">{fmt(e.createdAt)}</span>
                  </div>
                  <h3 className="mt-2 text-sm font-bold text-gray-900">{e.title}</h3>
                  <p className="text-xs text-gray-500">
                    {e.projectTitle}{e.ngoName ? ` · ${e.ngoName}` : ""}
                  </p>
                  <p className="mt-2 text-sm text-gray-600">{e.body}</p>
                  {e.mediaUrls.length > 0 && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {e.mediaUrls.slice(0, 4).map((url, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={url} alt="Impact evidence" className="h-24 w-24 object-cover rounded-lg border border-gray-200" />
                      ))}
                    </div>
                  )}
                  <UpdateFeedback projectId={e.projectId} eventId={e.id} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
