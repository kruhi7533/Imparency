"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { queue, shrinkPhoto, syncOutcome, toFormData, type QueuedCapture } from "@/lib/field-queue";

/**
 * Week 7 mobile field app. Every capture goes into the on-device queue first
 * and is synced when there is a connection — automatically when the phone
 * comes back online, or with the Sync button.
 */

interface Task {
  id: string;
  title: string;
  instructions: string | null;
  status: string;
  dueDate: string | null;
  project: { title: string; location: string };
  milestone: { title: string } | null;
  evidence: Array<{ status: string; reviewNote: string | null }>;
}

const TASK_CACHE = "field-tasks-cache";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const blankForm = {
  note: "",
  containsPeople: true,
  withFeedback: false,
  beneficiaryRef: "",
  consentMethod: "VERBAL" as "VERBAL" | "WRITTEN" | "THUMBPRINT",
  consentToRecord: false,
  consentToSharePhoto: false,
  rating: "",
  feedbackText: "",
};

export default function FieldApp({ userName }: { userName: string }) {
  const [online, setOnline] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksFromCache, setTasksFromCache] = useState(false);
  const [queued, setQueued] = useState<QueuedCapture[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [active, setActive] = useState<Task | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [gps, setGps] = useState<{ latitude: number; longitude: number; accuracyM: number } | null>(null);
  const [gpsState, setGpsState] = useState<"idle" | "locating" | "failed">("idle");
  const [form, setForm] = useState(blankForm);

  const refreshQueue = useCallback(() => queue.all().then(setQueued).catch(() => setQueued([])), []);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/ngo/field-tasks", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTasks(data.tasks);
      setTasksFromCache(false);
      try {
        localStorage.setItem(TASK_CACHE, JSON.stringify(data.tasks));
      } catch {}
    } catch {
      try {
        const cached = localStorage.getItem(TASK_CACHE);
        if (cached) {
          setTasks(JSON.parse(cached));
          setTasksFromCache(true);
        }
      } catch {}
    }
  }, []);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    let sent = 0;
    try {
      for (const c of await queue.all()) {
        if (c.error) continue;
        let status: number | "network-error";
        let error = "";
        try {
          const res = await fetch("/api/field/evidence", { method: "POST", body: toFormData(c) });
          status = res.status;
          if (!res.ok) error = (await res.json().catch(() => ({}))).error || `Error ${res.status}`;
        } catch {
          status = "network-error";
        }
        const outcome = syncOutcome(status);
        if (outcome === "done") {
          await queue.remove(c.clientId);
          sent++;
        } else if (outcome === "failed") {
          await queue.put({ ...c, error });
        } else {
          break; // offline or server trouble — try again later
        }
      }
    } finally {
      setSyncing(false);
      await refreshQueue();
      if (sent > 0) {
        setMessage(`Synced ${sent} capture${sent === 1 ? "" : "s"}.`);
        loadTasks();
      }
    }
  }, [syncing, refreshQueue, loadTasks]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/field-sw.js", { scope: "/ngo/field" }).catch(() => {});
    }
    loadTasks();
    refreshQueue().then(() => {
      if (navigator.onLine) sync();
    });
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locate = () => {
    if (!("geolocation" in navigator)) return setGpsState("failed");
    setGpsState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) });
        setGpsState("idle");
      },
      () => setGpsState("failed"),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  };

  const openTask = (t: Task) => {
    setActive(t);
    setPhoto(null);
    setGps(null);
    setForm(blankForm);
    setMessage(null);
    locate();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!photo && !form.withFeedback) return setMessage("Take a photo or record beneficiary feedback.");
    const capture: QueuedCapture = {
      clientId: newId(),
      taskId: active.id,
      taskTitle: active.title,
      capturedAt: new Date().toISOString(),
      latitude: gps?.latitude ?? null,
      longitude: gps?.longitude ?? null,
      accuracyM: gps?.accuracyM ?? null,
      note: form.note.trim(),
      containsPeople: form.containsPeople,
      photo: photo ? await shrinkPhoto(photo) : null,
      feedback: form.withFeedback
        ? {
            beneficiaryRef: form.beneficiaryRef.trim(),
            consentMethod: form.consentMethod,
            consentToRecord: form.consentToRecord,
            consentToSharePhoto: form.consentToRecord && form.consentToSharePhoto,
            rating: form.rating ? Number(form.rating) : null,
            feedbackText: form.feedbackText.trim(),
          }
        : null,
    };
    await queue.put(capture);
    await refreshQueue();
    setActive(null);
    setMessage(online ? "Saved. Syncing…" : "Saved on this phone. It will sync when you are back online.");
    if (navigator.onLine) sync();
  };

  const discard = async (clientId: string) => {
    if (!confirm("Discard this capture? It has not been sent.")) return;
    await queue.remove(clientId);
    refreshQueue();
  };

  const pending = queued.filter((q) => !q.error);
  const failed = queued.filter((q) => q.error);
  const input = "mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base";

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="sticky top-0 z-10 bg-emerald-700 text-white px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs opacity-80">Field app</p>
          <p className="font-bold">{userName}</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`}>
          {online ? "Online" : "Offline"}
        </span>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {message && <div className="p-3 rounded-xl bg-white border border-emerald-200 text-sm text-emerald-800">{message}</div>}

        {/* Sync queue */}
        <section className="bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-bold">{pending.length} waiting to sync</p>
            <p className="text-xs text-gray-500">Captures are saved on this phone first.</p>
          </div>
          <button
            onClick={sync}
            disabled={syncing || pending.length === 0 || !online}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </section>
        {failed.map((f) => (
          <section key={f.clientId} className="bg-red-50 border border-red-200 rounded-2xl p-3 text-sm">
            <p className="font-bold text-red-800">{f.taskTitle}: not accepted</p>
            <p className="text-red-700 text-xs">{f.error}</p>
            <button onClick={() => discard(f.clientId)} className="mt-1 text-xs font-bold text-red-700 underline">
              Discard
            </button>
          </section>
        ))}

        {/* Capture form */}
        {active ? (
          <form onSubmit={save} className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
            <div>
              <p className="text-xs text-gray-500">{active.project.title}</p>
              <h2 className="text-lg font-bold">{active.title}</h2>
              {active.instructions && <p className="text-sm text-gray-600 mt-1">{active.instructions}</p>}
            </div>

            <label className="block text-sm font-bold">
              Photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm"
              />
            </label>
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={URL.createObjectURL(photo)} alt="Captured" className="rounded-xl max-h-60 w-full object-cover" />
            )}

            <div className="text-sm flex items-center justify-between gap-2 p-3 rounded-xl bg-gray-50">
              <span>
                {gps
                  ? `📍 ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)} (±${gps.accuracyM} m)`
                  : gpsState === "locating"
                  ? "📍 Getting location…"
                  : "📍 No location yet"}
              </span>
              <button type="button" onClick={locate} className="text-xs font-bold text-emerald-700">
                {gps ? "Refresh" : "Retry"}
              </button>
            </div>

            <label className="block text-sm font-bold">
              Note
              <textarea
                rows={3}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="What does this show?"
                className={input}
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.containsPeople}
                onChange={(e) => setForm({ ...form, containsPeople: e.target.checked })}
                className="w-5 h-5"
              />
              The photo shows people
            </label>

            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={form.withFeedback}
                onChange={(e) => setForm({ ...form, withFeedback: e.target.checked })}
                className="w-5 h-5"
              />
              Record beneficiary feedback & consent
            </label>

            {form.withFeedback && (
              <div className="space-y-3 p-3 rounded-xl border border-gray-200">
                <label className="block text-sm">
                  Beneficiary reference (no names)
                  <input
                    value={form.beneficiaryRef}
                    onChange={(e) => setForm({ ...form, beneficiaryRef: e.target.value })}
                    placeholder="e.g. HH-014"
                    maxLength={40}
                    className={input}
                  />
                </label>
                <label className="block text-sm">
                  How was consent given?
                  <select
                    value={form.consentMethod}
                    onChange={(e) => setForm({ ...form, consentMethod: e.target.value as typeof form.consentMethod })}
                    className={input}
                  >
                    <option value="VERBAL">Verbal</option>
                    <option value="WRITTEN">Written / signed</option>
                    <option value="THUMBPRINT">Thumbprint</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.consentToRecord}
                    onChange={(e) => setForm({ ...form, consentToRecord: e.target.checked, consentToSharePhoto: e.target.checked && form.consentToSharePhoto })}
                    className="w-5 h-5 mt-0.5"
                  />
                  Agrees to their feedback being recorded
                </label>
                <label className={`flex items-start gap-2 text-sm ${form.consentToRecord ? "" : "opacity-40"}`}>
                  <input
                    type="checkbox"
                    disabled={!form.consentToRecord}
                    checked={form.consentToSharePhoto}
                    onChange={(e) => setForm({ ...form, consentToSharePhoto: e.target.checked })}
                    className="w-5 h-5 mt-0.5"
                  />
                  Agrees to the photo being shown to the funder
                </label>
                {form.consentToRecord ? (
                  <>
                    <label className="block text-sm">
                      Rating (1–5)
                      <select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} className={input}>
                        <option value="">No rating</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      Feedback
                      <textarea
                        rows={3}
                        value={form.feedbackText}
                        onChange={(e) => setForm({ ...form, feedbackText: e.target.value })}
                        className={input}
                      />
                    </label>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">
                    Without consent to record, only the fact that consent was asked is saved — no feedback.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setActive(null)} className="flex-1 py-3 rounded-xl border text-sm font-bold">
                Cancel
              </button>
              <button type="submit" className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold">
                Save capture
              </button>
            </div>
          </form>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">My tasks</h2>
              {tasksFromCache && <span className="text-xs text-amber-700">Showing saved list (offline)</span>}
            </div>
            {tasks.length === 0 && <p className="text-sm text-gray-500">No tasks assigned to you.</p>}
            {tasks.map((t) => {
              const last = t.evidence[0];
              return (
                <button
                  key={t.id}
                  onClick={() => openTask(t)}
                  disabled={t.status === "COMPLETED"}
                  className="w-full text-left bg-white rounded-2xl p-4 shadow-sm disabled:opacity-60"
                >
                  <div className="flex justify-between gap-2">
                    <p className="font-bold">{t.title}</p>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 h-fit">{t.status}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {t.project.title}
                    {t.milestone ? ` · ${t.milestone.title}` : ""}
                    {t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString("en-IN")}` : ""}
                  </p>
                  {last?.status === "RESUBMIT_REQUESTED" && (
                    <p className="text-xs text-red-700 mt-1">Resubmit requested: {last.reviewNote}</p>
                  )}
                </button>
              );
            })}
          </section>
        )}

        <Link href="/ngo/dashboard" className="block text-center text-xs text-gray-500 underline">
          Back to dashboard
        </Link>
      </main>
    </div>
  );
}
