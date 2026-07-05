"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const POLL_MS = 60_000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * In-app notification bell for the Navbar. Fetches on mount, polls lightly,
 * and marks everything read when the dropdown is opened so the badge reflects
 * genuinely-new items only.
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/user/notifications");
      if (!res.ok) return;
      const data = await res.json();
      if (!mounted.current) return;
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      // Network hiccups are fine — the next poll retries.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [fetchNotifications]);

  const handleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Optimistically clear the badge; the server call is best-effort.
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      try {
        await fetch("/api/user/notifications", { method: "PATCH" });
      } catch {
        // Badge will resync on the next poll.
      }
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2 text-gray-400 hover:text-white rounded-full hover:bg-white/5 transition focus:outline-none"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="w-4.5 h-4.5" size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] bg-gray-950 border border-gray-900 rounded-xl shadow-xl z-20 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-900 flex items-center justify-between">
              <span className="text-xs font-extrabold text-white">Notifications</span>
              {items.length > 0 && (
                <span className="text-[10px] text-gray-500 font-semibold">{items.length} recent</span>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-900">
              {loading ? (
                <div className="px-4 py-6 text-center text-xs text-gray-500">Loading…</div>
              ) : items.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="w-6 h-6 text-gray-700 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 font-medium">No notifications yet.</p>
                </div>
              ) : (
                items.map((n) => (
                  <div key={n.id} className={`px-4 py-3 ${n.read ? "" : "bg-emerald-500/5"}`}>
                    <div className="flex items-start gap-2">
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-200 leading-snug">{n.title}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed line-clamp-3">{n.body}</p>
                        <p className="text-[10px] text-gray-600 mt-1 font-semibold">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
