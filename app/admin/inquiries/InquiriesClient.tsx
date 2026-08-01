"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface ThreadMessage {
  id: string;
  authorRole: string; // "ADMIN" | "NGO"
  body: string;
  createdAt: string;
}

interface Thread {
  id: string;
  kind: string; // "INQUIRY" | "APPEAL"
  subject: string;
  entityType: string | null;
  entityId: string | null;
  status: string; // "OPEN" | "NGO_RESPONDED" | "RESOLVED"
  createdAt: string;
  updatedAt: string;
  subjectType: string; // "NGO" | "DONOR"
  subjectName: string;
  messages: ThreadMessage[];
}

interface Props {
  initialThreads: Thread[];
  initialEmailToggle: boolean;
}

type Tab = "needs_response" | "open" | "resolved";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30",
  NGO_RESPONDED: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30",
};

export default function InquiriesClient({ initialThreads, initialEmailToggle }: Props) {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [tab, setTab] = useState<Tab>("needs_response");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [emailToggle, setEmailToggle] = useState(initialEmailToggle);
  const [togglingEmail, setTogglingEmail] = useState(false);

  async function toggleEmail() {
    const next = !emailToggle;
    setTogglingEmail(true);
    setError("");
    setEmailToggle(next); // optimistic
    try {
      const res = await fetch("/api/admin/settings/ngo-reply-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update setting");
      setEmailToggle(data.enabled);
    } catch (err: any) {
      setEmailToggle(!next); // revert
      setError(err.message || "Could not update the email setting");
    } finally {
      setTogglingEmail(false);
    }
  }

  const visible = threads.filter((t) => {
    if (tab === "needs_response") return t.status === "NGO_RESPONDED";
    if (tab === "open") return t.status === "OPEN";
    return t.status === "RESOLVED";
  });

  const counts = {
    needs_response: threads.filter((t) => t.status === "NGO_RESPONDED").length,
    open: threads.filter((t) => t.status === "OPEN").length,
    resolved: threads.filter((t) => t.status === "RESOLVED").length,
  };

  async function act(threadId: string, message: string | null, resolve: boolean) {
    setBusyId(threadId);
    setError("");
    try {
      const res = await fetch(`/api/admin/threads/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message || undefined, resolve }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                status: data.status,
                messages: message
                  ? [
                      ...t.messages,
                      {
                        id: Date.now().toString(),
                        authorRole: "ADMIN",
                        body: message,
                        createdAt: new Date().toISOString(),
                      },
                    ]
                  : t.messages,
              }
            : t
        )
      );
      setReply("");
      if (resolve) setExpandedId(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Email notification toggle */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-3.5 shadow-sm">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            Email the admin inbox when an NGO replies
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {emailToggle
              ? "On top of the in-app badge, the shared admin inbox gets an email the moment an NGO responds or opens an appeal. This setting applies to all admins."
              : "Email alerts are off. New NGO replies still show up here and as a count badge on “Inquiries” in the top nav. This setting applies to all admins."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={emailToggle}
          aria-label="Toggle admin inbox email notifications for NGO replies"
          disabled={togglingEmail}
          onClick={toggleEmail}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            emailToggle ? "bg-emerald-600" : "bg-gray-300 dark:bg-gray-700"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              emailToggle ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(
          [
            ["needs_response", "Needs Response"],
            ["open", "Awaiting NGO"],
            ["resolved", "Resolved"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
              tab === key
                ? "bg-emerald-600 text-white"
                : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No threads here right now.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((t) => {
            const expanded = expandedId === t.id;
            const busy = busyId === t.id;
            return (
              <div
                key={t.id}
                className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden"
              >
                <button
                  onClick={() => {
                    setExpandedId(expanded ? null : t.id);
                    setReply("");
                  }}
                  className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                          t.kind === "APPEAL"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {t.kind}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[t.status] || ""}`}>
                        {t.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-bold text-gray-900 dark:text-white truncate">{t.subject}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t.subjectName} ({t.subjectType}) · {t.messages.length} message{t.messages.length === 1 ? "" : "s"} · updated {fmtDateTime(t.updatedAt)}
                    </p>
                  </div>
                  <span className="text-gray-400 text-sm shrink-0">{expanded ? "▲" : "▼"}</span>
                </button>

                {expanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 space-y-4">
                    {/* Messages */}
                    <div className="space-y-3">
                      {t.messages.map((m) => (
                        <div
                          key={m.id}
                          className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                            m.authorRole === "ADMIN"
                              ? "ml-auto bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200"
                              : "bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                          }`}
                        >
                          <p className="text-[10px] font-extrabold uppercase tracking-wider opacity-60 mb-0.5">
                            {m.authorRole === "ADMIN" ? "Admin" : t.subjectName} · {fmtDateTime(m.createdAt)}
                          </p>
                          <p className="whitespace-pre-wrap">{m.body}</p>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    {t.status !== "RESOLVED" && (
                      <div className="space-y-2">
                        <textarea
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          rows={3}
                          placeholder="Write a reply…"
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <div className="flex justify-end gap-3">
                          <button
                            disabled={busy}
                            onClick={() => act(t.id, reply.trim() || null, true)}
                            className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
                          >
                            {reply.trim() ? "Reply & Resolve" : "Mark Resolved"}
                          </button>
                          <button
                            disabled={busy || !reply.trim()}
                            onClick={() => act(t.id, reply.trim(), false)}
                            className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                          >
                            {busy ? "Working…" : "Send Reply"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
