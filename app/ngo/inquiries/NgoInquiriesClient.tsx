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
  status: string; // "OPEN" | "NGO_RESPONDED" | "RESOLVED"
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

interface DonorInquiryMessage {
  id: string;
  senderId: string;
  senderRole: "DONOR" | "NGO";
  body: string;
  createdAt: string;
}

interface DonorInquiry {
  id: string;
  donorName: string;
  donorEmail: string;
  donorTotalDonated: number;
  status: string; // "OPEN" | "RESPONDED" | "RESOLVED"
  createdAt: string;
  updatedAt: string;
  messages: DonorInquiryMessage[];
}

interface Props {
  initialThreads: Thread[];
  initialDonorInquiries: DonorInquiry[];
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_LABEL: Record<string, { label: string; classes: string }> = {
  OPEN: {
    label: "Awaiting your reply",
    classes: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30",
  },
  NGO_RESPONDED: {
    label: "Awaiting admin",
    classes: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30",
  },
  RESOLVED: {
    label: "Resolved",
    classes: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30",
  },
};

const DONOR_STATUS_LABEL: Record<string, { label: string; classes: string }> = {
  OPEN: {
    label: "Awaiting your reply",
    classes: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30",
  },
  RESPONDED: {
    label: "Replied",
    classes: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30",
  },
};

export default function NgoInquiriesClient({ initialThreads, initialDonorInquiries = [] }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"admin" | "donor">("admin");
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [donorInquiries, setDonorInquiries] = useState<DonorInquiry[]>(initialDonorInquiries);

  // Admin inquiries state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Donor inquiries state
  const [donorExpandedId, setDonorExpandedId] = useState<string | null>(null);
  const [donorReply, setDonorReply] = useState("");
  const [donorBusyId, setDonorBusyId] = useState<string | null>(null);

  const [error, setError] = useState("");

  // New appeal modal
  const [showAppeal, setShowAppeal] = useState(false);
  const [appealSubject, setAppealSubject] = useState("");
  const [appealMessage, setAppealMessage] = useState("");
  const [appealBusy, setAppealBusy] = useState(false);

  async function sendReply(threadId: string) {
    if (!reply.trim()) return;
    setBusyId(threadId);
    setError("");
    try {
      const res = await fetch(`/api/ngo/threads/${threadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send reply");

      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                status: "NGO_RESPONDED",
                messages: [
                  ...t.messages,
                  {
                    id: Date.now().toString(),
                    authorRole: "NGO",
                    body: reply.trim(),
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : t
        )
      );
      setReply("");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function sendDonorReply(threadId: string) {
    if (!donorReply.trim()) return;
    setDonorBusyId(threadId);
    setError("");
    try {
      const res = await fetch(`/api/ngo/inquiries/${threadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: donorReply.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send reply");

      setDonorInquiries((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                status: "RESPONDED",
                messages: [
                  ...t.messages,
                  {
                    id: Date.now().toString(),
                    senderId: "me",
                    senderRole: "NGO",
                    body: donorReply.trim(),
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : t
        )
      );
      setDonorReply("");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setDonorBusyId(null);
    }
  }

  async function submitAppeal(e: React.FormEvent) {
    e.preventDefault();
    if (!appealSubject.trim() || !appealMessage.trim()) return;
    setAppealBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ngo/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: appealSubject.trim(), message: appealMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to open appeal");
      setShowAppeal(false);
      setAppealSubject("");
      setAppealMessage("");
      router.refresh();
      // Optimistically add
      setThreads((prev) => [
        {
          id: data.threadId,
          kind: "APPEAL",
          subject: appealSubject.trim(),
          status: "NGO_RESPONDED",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [
            {
              id: Date.now().toString(),
              authorRole: "NGO",
              body: appealMessage.trim(),
              createdAt: new Date().toISOString(),
            },
          ],
        },
        ...prev,
      ]);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setAppealBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300 animate-in fade-in">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-6">
        <button
          type="button"
          onClick={() => {
            setActiveTab("admin");
            setError("");
          }}
          className={`flex-1 pb-3 text-sm font-extrabold text-center border-b-2 transition ${
            activeTab === "admin"
              ? "border-emerald-650 text-emerald-650 dark:text-emerald-455"
              : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          Admin Inquiries ({threads.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("donor");
            setError("");
          }}
          className={`flex-1 pb-3 text-sm font-extrabold text-center border-b-2 transition ${
            activeTab === "donor"
              ? "border-emerald-650 text-emerald-650 dark:text-emerald-455"
              : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          Donor Questions ({donorInquiries.length})
        </button>
      </div>

      {activeTab === "admin" ? (
        /* Tab 1: Admin Inquiries */
        <div className="space-y-6">
          <div className="flex justify-end">
            <button
              onClick={() => setShowAppeal(true)}
              className="px-4 py-2 text-sm font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition"
            >
              + Open an Appeal
            </button>
          </div>

          {threads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                No inquiries or appeals yet. When the admin team has a question about your submissions, it will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {threads.map((t) => {
                const expanded = expandedId === t.id;
                const busy = busyId === t.id;
                const badge = STATUS_LABEL[t.status] ?? STATUS_LABEL.OPEN;
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
                            {t.kind === "APPEAL" ? "Appeal" : "Admin question"}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.classes}`}>
                            {badge.label}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-bold text-gray-900 dark:text-white truncate">{t.subject}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t.messages.length} message{t.messages.length === 1 ? "" : "s"} · updated {fmtDateTime(t.updatedAt)}
                        </p>
                      </div>
                      <span className="text-gray-400 text-sm shrink-0">{expanded ? "▲" : "▼"}</span>
                    </button>

                    {expanded && (
                      <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 space-y-4">
                        <div className="space-y-3">
                          {t.messages.map((m) => (
                            <div
                              key={m.id}
                              className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                                m.authorRole === "NGO"
                                  ? "ml-auto bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200"
                                  : "bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                              }`}
                            >
                              <p className="text-[10px] font-extrabold uppercase tracking-wider opacity-60 mb-0.5">
                                {m.authorRole === "NGO" ? "You" : "Admin"} · {fmtDateTime(m.createdAt)}
                              </p>
                              <p className="whitespace-pre-wrap">{m.body}</p>
                            </div>
                          ))}
                        </div>

                        {t.status !== "RESOLVED" && (
                          <div className="space-y-2">
                            <textarea
                              value={reply}
                              onChange={(e) => setReply(e.target.value)}
                              rows={3}
                              placeholder="Write your reply to the admin team…"
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <div className="flex justify-end">
                              <button
                                disabled={busy || !reply.trim()}
                                onClick={() => sendReply(t.id)}
                                className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                              >
                                {busy ? "Sending…" : "Send Reply"}
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
      ) : (
        /* Tab 2: Donor Questions */
        <div className="space-y-6">
          {donorInquiries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                No direct questions from donors yet. When supporters ask questions on your profile page, they will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {donorInquiries.map((t) => {
                const expanded = donorExpandedId === t.id;
                const busy = donorBusyId === t.id;
                const badge = DONOR_STATUS_LABEL[t.status] ?? DONOR_STATUS_LABEL.OPEN;
                return (
                  <div
                    key={t.id}
                    className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setDonorExpandedId(expanded ? null : t.id);
                        setDonorReply("");
                      }}
                      className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.classes}`}>
                            {badge.label}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30 font-bold">
                            Total Donated: ₹{t.donorTotalDonated.toLocaleString('en-IN')}
                          </span>
                        </div>
                        <p className="text-sm font-black text-gray-900 dark:text-white truncate">
                          Inquiry from: {t.donorName}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {t.donorEmail} · {t.messages.length} message{t.messages.length === 1 ? "" : "s"} · updated {fmtDateTime(t.updatedAt)}
                        </p>
                      </div>
                      <span className="text-gray-400 text-sm shrink-0">{expanded ? "▲" : "▼"}</span>
                    </button>

                    {expanded && (
                      <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 space-y-4">
                        <div className="space-y-3">
                          {t.messages.map((m) => {
                            const isMe = m.senderRole === "NGO";
                            return (
                              <div
                                key={m.id}
                                className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                                  isMe
                                    ? "ml-auto bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200"
                                    : "bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                                }`}
                              >
                                <p className="text-[10px] font-extrabold uppercase tracking-wider opacity-60 mb-0.5">
                                  {isMe ? "You (NGO)" : t.donorName} · {fmtDateTime(m.createdAt)}
                                </p>
                                <p className="whitespace-pre-wrap">{m.body}</p>
                              </div>
                            );
                          })}
                        </div>

                        <div className="space-y-2">
                          <textarea
                            value={donorReply}
                            onChange={(e) => setDonorReply(e.target.value)}
                            rows={3}
                            placeholder={`Reply to ${t.donorName}…`}
                            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <div className="flex justify-end">
                            <button
                              disabled={busy || !donorReply.trim()}
                              onClick={() => sendDonorReply(t.id)}
                              className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                            >
                              {busy ? "Sending…" : "Send Reply"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Appeal modal */}
      {showAppeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Open an Appeal</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Contest a rejection or suspension decision. Your message goes directly to the admin team.
            </p>
            <form onSubmit={submitAppeal} className="mt-4 space-y-3">
              <input
                value={appealSubject}
                onChange={(e) => setAppealSubject(e.target.value)}
                placeholder="Subject — e.g. Appeal against suspension"
                required
                maxLength={200}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <textarea
                value={appealMessage}
                onChange={(e) => setAppealMessage(e.target.value)}
                rows={5}
                required
                placeholder="Explain why you believe the decision should be reconsidered. Include any supporting details…"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAppeal(false)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={appealBusy || !appealSubject.trim() || !appealMessage.trim()}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {appealBusy ? "Submitting…" : "Submit Appeal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
