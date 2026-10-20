"use client";

import React, { useCallback, useEffect, useState } from "react";

interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const humanise = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default function NotificationsClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: "30", ...(from ? { cursor: from } : {}), ...(unreadOnly ? { unread: "1" } : {}) });
        const res = await fetch(`/api/user/notifications?${qs}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load notifications.");
        setItems((prev) => (from ? [...prev, ...data.notifications] : data.notifications));
        setUnread(data.unreadCount ?? 0);
        setCursor(data.nextCursor ?? null);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [unreadOnly]
  );

  useEffect(() => {
    load(null);
  }, [load]);

  const markRead = async (ids?: string[]) => {
    const res = await fetch("/api/user/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
    });
    if (!res.ok) return setError("Could not update notifications.");
    setItems((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    setUnread((u) => (ids ? Math.max(0, u - ids.length) : 0));
  };

  const tab = (active: boolean) =>
    `min-h-[40px] px-4 rounded-full text-xs font-bold ${active ? "bg-white text-gray-900" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`;

  return (
    <main className="min-h-screen bg-gray-950">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">Notifications</h1>
            <p className="text-sm text-gray-400" aria-live="polite">
              {unread} unread
            </p>
          </div>
          {unread > 0 && (
            <button type="button" onClick={() => markRead()} className="min-h-[44px] px-4 rounded-lg border border-gray-700 text-sm font-bold text-gray-200 hover:bg-gray-900">
              Mark all as read
            </button>
          )}
        </div>

        <div role="group" aria-label="Show" className="mt-6 flex gap-2">
          <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)} className={tab(!unreadOnly)}>
            All
          </button>
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)} className={tab(unreadOnly)}>
            Unread
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {error}
          </p>
        )}

        {!loading && items.length === 0 && !error ? (
          <p className="mt-10 text-sm text-gray-400">{unreadOnly ? "Nothing unread." : "No notifications yet."}</p>
        ) : (
          <ul className="mt-6 space-y-2">
            {items.map((n) => (
              <li key={n.id} className={`rounded-xl border p-4 ${n.read ? "border-gray-800 bg-gray-900/40" : "border-emerald-500/30 bg-emerald-500/5"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      {!n.read && <span className="sr-only">Unread. </span>}
                      {humanise(n.type)}
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-white">{n.title}</p>
                    <p className="mt-1 text-sm text-gray-300 break-words">{n.body}</p>
                    <time dateTime={n.createdAt} className="mt-1 block text-xs text-gray-400">
                      {new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => markRead([n.id])}
                      aria-label={`Mark "${n.title}" as read`}
                      className="shrink-0 min-h-[40px] px-3 rounded-lg text-xs font-bold text-emerald-300 hover:bg-gray-900"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {loading && <p className="mt-4 text-sm text-gray-400">Loading…</p>}
        {cursor && !loading && (
          <button type="button" onClick={() => load(cursor)} className="mt-6 w-full min-h-[44px] rounded-lg border border-gray-700 text-sm font-bold text-gray-200 hover:bg-gray-900">
            Load older
          </button>
        )}
      </div>
    </main>
  );
}
