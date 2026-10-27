"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { describeFailure, queue, shrinkPhoto, syncOutcome, uploadCapture, type QueuedCapture } from "@/lib/field-queue";

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
  // Upload progress of the capture being sent right now (0..1).
  const [progress, setProgress] = useState<{ clientId: string; fraction: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [active, setActive] = useState<Task | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  // One object URL per photo, revoked when it changes — creating it in render
  // leaked a new blob URL on every keystroke, which matters on low-memory phones.
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);
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
        setProgress({ clientId: c.clientId, fraction: 0 });
        const result = await uploadCapture(c, (fraction) => setProgress({ clientId: c.clientId, fraction }));
        const outcome = syncOutcome(result.status);
        if (outcome === "done") {
          await queue.remove(c.clientId);
          sent++;
        } else if (outcome === "failed") {
          await queue.put({ ...c, error: describeFailure(result), errorCode: result.body.code });
        } else {
          // Offline or server trouble: keep it queued, but say why, so a
          // storage outage is visible instead of a silent "waiting to sync".
          await queue.put({ ...c, lastAttemptError: describeFailure(result), errorCode: result.body.code });
          break;
        }
      }
    } finally {
      setSyncing(false);
      setProgress(null);
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
    const shrunk = photo ? await shrinkPhoto(photo) : null;
    // Same limit the server enforces (MAX_PHOTO_BYTES), checked before queueing
    // so the worker can retake now rather than find a refused capture later.
    if (shrunk && shrunk.size > 8 * 1024 * 1024) return setMessage("This photo is larger than 8 MB. Take it again at a lower resolution.");
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
      photo: shrunk,
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

  const retry = async (c: QueuedCapture) => {
    await queue.put({ ...c, error: undefined, errorCode: undefined, lastAttemptError: undefined });
    await refreshQueue();
    sync();
  };

  const discard = async (clientId: string) => {
    if (!confirm("Discard this capture? It has not been sent.")) return;
    await queue.remove(clientId);
    refreshQueue();
  };

  const pending = queued.filter((q) => !q.error);
  const failed = queued.filter((q) => q.error);
  const input =
    "mt-1 w-full min-h-12 rounded-xl border-2 border-gray-300 bg-white px-3 py-2.5 text-base font-normal text-gray-900 placeholder:text-gray-500 focus:border-trust-600 focus:outline-none focus:ring-2 focus:ring-trust-600/30";

  return (
    <div className="min-h-screen pb-24 text-gray-900">
      {/* top-16: sits below the global sticky navbar instead of sliding under it. */}
      <header className="sticky top-16 z-10 bg-white border-b-2 border-gray-300 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-700">Field app</p>
          <p className="text-lg font-bold text-gray-900">{userName}</p>
        </div>
        <span role="status" aria-live="polite" className={`text-sm font-bold px-3 py-1.5 rounded-full ring-2 ${online ? "bg-emerald-100 text-emerald-900 ring-emerald-600" : "bg-amber-100 text-amber-900 ring-amber-600"}`}>
          {online ? "Online" : "Offline"}
        </span>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        <div role="status" aria-live="polite">
          {message && <div className="p-4 rounded-xl bg-emerald-50 border-2 border-emerald-600 text-base font-semibold text-emerald-900">{message}</div>}
        </div>

        {/* Sync queue */}
        <section className="bg-white rounded-2xl p-4 border border-gray-300 shadow-sm flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-bold text-gray-900">{pending.length} waiting to sync</p>
            <p className="text-sm text-gray-700">Captures are saved on this phone first.</p>
          </div>
          <button
            onClick={sync}
            disabled={syncing || pending.length === 0 || !online}
            className="min-h-12 shrink-0 px-5 py-3 rounded-xl bg-trust-600 hover:bg-trust-700 text-white text-base font-bold disabled:bg-gray-300 disabled:text-gray-700"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </section>
        {pending.length > 0 && (
          <ul className="space-y-2" aria-label="Captures waiting to sync">
            {pending.map((p) => {
              const sending = progress?.clientId === p.clientId;
              return (
                <li key={p.clientId} className="bg-white rounded-2xl p-4 border border-gray-300 shadow-sm text-base">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-gray-900 truncate">{p.taskTitle}</p>
                    <span className="text-sm font-semibold text-gray-700 shrink-0">
                      {sending ? `Uploading ${Math.round((progress?.fraction ?? 0) * 100)}%` : p.photo ? "Photo queued" : "Feedback queued"}
                    </span>
                  </div>
                  {sending && (
                    <div className="mt-2 h-3 rounded-full bg-gray-200 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress?.fraction ?? 0) * 100)}>
                      <div className="h-full bg-trust-600 transition-all" style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} />
                    </div>
                  )}
                  {!sending && p.lastAttemptError && (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-amber-900">Last attempt failed: {p.lastAttemptError}</p>
                      <button onClick={() => retry(p)} disabled={syncing || !online} className="min-h-12 px-3 text-base font-bold text-trust-700 underline disabled:opacity-40">
                        Retry
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {failed.map((f) => (
          <section key={f.clientId} role="alert" className="bg-red-50 border-2 border-red-600 rounded-2xl p-4 text-base">
            <p className="font-bold text-red-900">{f.taskTitle}: not accepted</p>
            <p className="text-red-800 text-sm">{f.error}</p>
            <div className="flex gap-4">
              <button onClick={() => retry(f)} disabled={syncing || !online} className="mt-1 min-h-12 px-2 -ml-2 text-base font-bold text-trust-700 underline disabled:opacity-40">
                Retry
              </button>
              <button onClick={() => discard(f.clientId)} className="mt-1 min-h-12 px-2 text-base font-bold text-red-800 underline">
                Discard
              </button>
            </div>
          </section>
        ))}

        {/* Capture form */}
        {active ? (
          <form onSubmit={save} className="bg-white rounded-2xl p-4 border border-gray-300 shadow-sm space-y-5">
            <div>
              <p className="text-sm font-semibold text-gray-700">{active.project.title}</p>
              <h2 className="text-xl font-bold text-gray-900">{active.title}</h2>
              {active.instructions && <p className="text-base text-gray-800 mt-1">{active.instructions}</p>}
            </div>

            <label className="block text-base font-bold text-gray-900">
              Photo <span className="text-sm font-normal text-gray-700">(JPEG, PNG, WebP or HEIC, up to 8 MB)</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                className="mt-2 block w-full text-base text-gray-900 file:mr-3 file:min-h-12 file:rounded-xl file:border-0 file:bg-trust-600 file:px-4 file:py-3 file:text-base file:font-bold file:text-white"
              />
            </label>
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl ?? undefined} alt="Preview of the photo you just took" className="rounded-xl border border-gray-300 max-h-60 w-full object-cover" />
            )}

            <div className="text-base text-gray-900 flex items-center justify-between gap-2 p-3 rounded-xl bg-gray-50 border border-gray-300">
              <span aria-live="polite">
                {gps
                  ? `📍 ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)} (±${gps.accuracyM} m)`
                  : gpsState === "locating"
                  ? "📍 Getting location…"
                  : "📍 No location yet"}
              </span>
              <button
                type="button"
                onClick={locate}
                aria-label={gps ? "Refresh location" : "Retry getting location"}
                className="min-h-12 shrink-0 px-4 rounded-xl border-2 border-trust-600 bg-white text-base font-bold text-trust-700 hover:bg-trust-50"
              >
                {gps ? "Refresh" : "Retry"}
              </button>
            </div>

            <label className="block text-base font-bold text-gray-900">
              Note
              <textarea
                rows={3}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="What does this show?"
                className={input}
              />
            </label>

            <label className="flex items-center gap-3 min-h-12 text-base text-gray-900">
              <input
                type="checkbox"
                checked={form.containsPeople}
                onChange={(e) => setForm({ ...form, containsPeople: e.target.checked })}
                className="w-6 h-6 shrink-0 accent-trust-600"
              />
              The photo shows people
            </label>

            <label className="flex items-center gap-3 min-h-12 text-base font-bold text-gray-900">
              <input
                type="checkbox"
                checked={form.withFeedback}
                onChange={(e) => setForm({ ...form, withFeedback: e.target.checked })}
                className="w-6 h-6 shrink-0 accent-trust-600"
              />
              Record beneficiary feedback & consent
            </label>

            {form.withFeedback && (
              <div className="space-y-4 p-4 rounded-xl border-2 border-gray-300 bg-gray-50">
                <label className="block text-base font-semibold text-gray-900">
                  Beneficiary reference (no names)
                  <input
                    value={form.beneficiaryRef}
                    onChange={(e) => setForm({ ...form, beneficiaryRef: e.target.value })}
                    placeholder="e.g. HH-014"
                    maxLength={40}
                    className={input}
                  />
                </label>
                <label className="block text-base font-semibold text-gray-900">
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
                <label className="flex items-start gap-3 min-h-12 text-base text-gray-900">
                  <input
                    type="checkbox"
                    checked={form.consentToRecord}
                    onChange={(e) => setForm({ ...form, consentToRecord: e.target.checked, consentToSharePhoto: e.target.checked && form.consentToSharePhoto })}
                    className="w-6 h-6 mt-0.5 shrink-0 accent-trust-600"
                  />
                  Agrees to their feedback being recorded
                </label>
                <label className={`flex items-start gap-3 min-h-12 text-base text-gray-900 ${form.consentToRecord ? "" : "opacity-40"}`}>
                  <input
                    type="checkbox"
                    disabled={!form.consentToRecord}
                    checked={form.consentToSharePhoto}
                    onChange={(e) => setForm({ ...form, consentToSharePhoto: e.target.checked })}
                    className="w-6 h-6 mt-0.5 shrink-0 accent-trust-600"
                  />
                  Agrees to the photo being shown to the funder
                </label>
                {form.consentToRecord ? (
                  <>
                    <label className="block text-base font-semibold text-gray-900">
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
                    <label className="block text-base font-semibold text-gray-900">
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
                  <p className="text-sm text-gray-800">
                    Without consent to record, only the fact that consent was asked is saved — no feedback.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setActive(null)} className="flex-1 min-h-12 py-3 rounded-xl border-2 border-gray-300 bg-white text-gray-900 text-base font-bold hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" className="flex-1 min-h-12 py-3 rounded-xl bg-trust-600 hover:bg-trust-700 text-white text-base font-bold">
                Save capture
              </button>
            </div>
          </form>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">My tasks</h2>
              {tasksFromCache && <span className="text-sm font-semibold text-amber-900">Showing saved list (offline)</span>}
            </div>
            {tasks.length === 0 && <p className="text-base text-gray-700 bg-white border border-gray-300 rounded-2xl p-4">No tasks assigned to you.</p>}
            {tasks.map((t) => {
              const last = t.evidence[0];
              return (
                <button
                  key={t.id}
                  onClick={() => openTask(t)}
                  disabled={t.status === "COMPLETED"}
                  aria-label={`${t.title}, ${t.status.toLowerCase().replace(/_/g, " ")}${t.status === "COMPLETED" ? "" : ", open to capture evidence"}`}
                  className="w-full min-h-12 text-left bg-white rounded-2xl p-4 border border-gray-300 shadow-sm hover:border-trust-600 active:bg-gray-50 disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-trust-600"
                >
                  <div className="flex justify-between gap-2">
                    <p className="text-base font-bold text-gray-900">{t.title}</p>
                    <span className="text-xs font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-900 ring-1 ring-gray-400 h-fit shrink-0">{t.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-700">
                    {t.project.title}
                    {t.milestone ? ` · ${t.milestone.title}` : ""}
                    {t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString("en-IN")}` : ""}
                  </p>
                  {last?.status === "RESUBMIT_REQUESTED" && (
                    <p className="text-sm font-medium text-red-800 mt-1">Resubmit requested: {last.reviewNote}</p>
                  )}
                </button>
              );
            })}
          </section>
        )}

        <Link href="/ngo/dashboard" className="flex min-h-12 items-center justify-center text-base font-semibold text-trust-700 underline">
          Back to dashboard
        </Link>
      </main>
    </div>
  );
}
