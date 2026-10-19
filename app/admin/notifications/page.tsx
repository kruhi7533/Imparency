import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTIFICATION_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  NGO_VERIFICATION: {
    bg: "bg-blue-50 dark:bg-blue-950/20",
    border: "border-blue-200 dark:border-blue-900/50",
    icon: "🏢",
  },
  FRAUD_ALERT: {
    bg: "bg-red-50 dark:bg-red-950/20",
    border: "border-red-200 dark:border-red-900/50",
    icon: "⚠️",
  },
  PROOF_REVIEW: {
    bg: "bg-amber-50 dark:bg-amber-950/20",
    border: "border-amber-200 dark:border-amber-900/50",
    icon: "📸",
  },
  PROJECT_DECISION: {
    bg: "bg-emerald-50 dark:bg-emerald-950/20",
    border: "border-emerald-200 dark:border-emerald-900/50",
    icon: "✓",
  },
  PAYMENT: {
    bg: "bg-purple-50 dark:bg-purple-950/20",
    border: "border-purple-200 dark:border-purple-900/50",
    icon: "💳",
  },
  SYSTEM: {
    bg: "bg-gray-50 dark:bg-gray-800/20",
    border: "border-gray-200 dark:border-gray-700/50",
    icon: "⚙️",
  },
};

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: { type?: string; read?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/login");
  }

  const typeFilter = searchParams.type || "";
  const readFilter = searchParams.read || "";

  const notifications = await prisma.notification.findMany({
    where: {
      userId: session.user.id,
      ...(typeFilter ? { type: typeFilter } : {}),
      ...(readFilter === "unread" ? { read: false } : readFilter === "read" ? { read: true } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const stats = await Promise.all([
    prisma.notification.count({ where: { userId: session.user.id, read: false } }),
    prisma.notification.count({ where: { userId: session.user.id } }),
    prisma.notification.groupBy({
      by: ["type"],
      where: { userId: session.user.id },
      _count: true,
    }),
  ]).then(([unread, total, byType]) => ({ unread, total, byType }));

  const notificationTypes = stats.byType.map((t) => ({
    type: t.type,
    count: t._count,
  }));

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-black text-gray-900 dark:text-white">Notifications</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            All admin notifications and alerts. {stats.total} total • {stats.unread} unread
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
          <Link
            href="/admin/notifications"
            className={`p-4 rounded-lg border transition ${
              !typeFilter && !readFilter
                ? "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700"
                : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-150 dark:hover:bg-gray-750"
            }`}
          >
            <div className="text-2xl font-black text-gray-900 dark:text-white">{stats.total}</div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-1">All</div>
          </Link>

          <Link
            href="/admin/notifications?read=unread"
            className={`p-4 rounded-lg border transition ${
              readFilter === "unread"
                ? "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700"
                : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-150 dark:hover:bg-gray-750"
            }`}
          >
            <div className="text-2xl font-black text-red-600 dark:text-red-400">{stats.unread}</div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-1">Unread</div>
          </Link>

          {notificationTypes.map((nt) => (
            <Link
              key={nt.type}
              href={`/admin/notifications?type=${nt.type}`}
              className={`p-4 rounded-lg border transition ${
                typeFilter === nt.type
                  ? "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700"
                  : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-150 dark:hover:bg-gray-750"
              }`}
            >
              <div className="text-2xl font-black text-gray-900 dark:text-white">{nt.count}</div>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-1 truncate">
                {nt.type.replace(/_/g, " ")}
              </div>
            </Link>
          ))}
        </div>

        {/* Notifications List */}
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-500 dark:text-gray-400">No notifications found</p>
            </div>
          ) : (
            notifications.map((notif) => {
              const colors = NOTIFICATION_COLORS[notif.type] || NOTIFICATION_COLORS.SYSTEM;
              return (
                <div
                  key={notif.id}
                  className={`border rounded-lg p-4 transition ${colors.bg} ${colors.border} ${
                    !notif.read ? "border-2" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl shrink-0">{colors.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                            {notif.title}
                          </h3>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            {notif.body}
                          </p>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500 shrink-0 whitespace-nowrap">
                          {formatTime(notif.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="inline-block text-[10px] font-semibold text-gray-500 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">
                          {notif.type.replace(/_/g, " ")}
                        </span>
                        {!notif.read && (
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
