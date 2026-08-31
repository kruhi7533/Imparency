"use client";

import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { ADMIN_HUBS, hubForPath } from "./hubs";

interface AdminNavProps {
  pendingProjectCount: number;
  unresolvedAlertsTotal: number;
  pendingCrisisCount?: number;
  inquiriesNeedingResponse: number;
  fieldsNeedingReview?: number;
}

/**
 * Top-level navigation: one link per hub, in lifecycle order.
 *
 * The pages themselves did not change — only how they are grouped and reached.
 * See ./hubs.ts for why, and AdminTabs for the second level.
 */
export default function AdminNav({ pendingProjectCount, unresolvedAlertsTotal, pendingCrisisCount, inquiriesNeedingResponse, fieldsNeedingReview }: AdminNavProps) {
  const pathname = usePathname();

  // Counts belong to a hub, not to a page inside it: the badge answers "which
  // hub needs me", and the tab bar inside answers "which part of it".
  const badgeFor: Record<string, number | undefined> = {
    verification: fieldsNeedingReview,
    delivery: pendingProjectCount,
    risk: unresolvedAlertsTotal,
    crisis: pendingCrisisCount,
    people: inquiriesNeedingResponse,
  };

  const activeHub = hubForPath(pathname);

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-3 shadow-sm">
      <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-y-2">
        <div className="flex items-center gap-2">
          <a href="/admin/today" className="flex items-center gap-2">
            <span className="text-xl font-black text-emerald-600 tracking-tight">ImpactBridge</span>
            <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-full font-bold">
              Admin Console
            </span>
          </a>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Administrator</span>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-xs font-semibold text-gray-500 hover:text-red-500 transition"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        {ADMIN_HUBS.map((hub) => {
          const active = activeHub?.key === hub.key;
          const badge = badgeFor[hub.key];
          return (
            <a
              key={hub.key}
              href={hub.href}
              className={
                active
                  ? "text-emerald-600 hover:text-emerald-700 transition underline decoration-2 underline-offset-4 flex items-center gap-1.5 text-sm font-semibold"
                  : "text-gray-500 hover:text-emerald-600 transition flex items-center gap-1.5 text-sm font-semibold"
              }
            >
              <span>{hub.label}</span>
              {!!badge && badge > 0 && (
                <span className="bg-red-100 dark:bg-red-950/45 text-red-600 dark:text-red-400 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                  {badge}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
