"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

interface Item {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** The admin top bar's bell: same feed as the site bell (/api/user/notifications), light styling. */
export default function AdminBell({ seeAllHref }: { seeAllHref: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/user/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      /* next poll retries */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => {
      clearInterval(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [load]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      fetch("/api/user/notifications", { method: "PATCH" }).catch(() => {});
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative grid h-10 w-10 place-items-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            {items.length > 0 && <span className="text-xs text-gray-500">{items.length} recent</span>}
          </div>
          <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-500">No notifications yet.</p>
            ) : (
              items.map((n) => (
                <div key={n.id} className={`px-4 py-3 ${n.read ? "" : "bg-trust-50/60"}`}>
                  <p className="text-sm font-medium leading-snug text-gray-900">{n.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{n.body}</p>
                  <p className="mt-1 text-[11px] text-gray-500">{timeAgo(n.createdAt)}</p>
                </div>
              ))
            )}
          </div>
          <a href={seeAllHref} className="block border-t border-gray-100 px-4 py-2.5 text-center text-xs font-semibold text-trust-700 hover:bg-gray-50">
            See all notifications
          </a>
        </div>
      )}
    </div>
  );
}
