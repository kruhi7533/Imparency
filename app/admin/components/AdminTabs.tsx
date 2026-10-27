"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { hubForPath, isTabActive } from "./hubs";
import { adminPageAllowed } from "@/lib/admin-roles";

/**
 * The tab bar inside a hub.
 *
 * Rendered once in the admin layout rather than added to thirteen pages: it
 * works out which hub the current path belongs to and shows that hub's tabs.
 * A page that belongs to no hub (an NGO detail view, a donor detail view)
 * simply gets nothing, which is correct — those are destinations you arrive at
 * from a queue, not places you navigate between.
 *
 * No badges here. Counts live in the top-level nav, where they tell you which
 * hub to open; repeating them inside the hub you already opened is noise.
 */
export default function AdminTabs({ adminRole }: { adminRole?: string | null } = {}) {
  const pathname = usePathname();
  const fullHub = hubForPath(pathname);
  const hub = fullHub ? { ...fullHub, tabs: fullHub.tabs.filter((t) => adminPageAllowed(adminRole, t.href)) } : null;

  if (!hub || hub.tabs.length <= 1) return null;

  const activeTab = hub.tabs.find((t) => isTabActive(pathname, t.href));

  return (
    <div className="border-b border-gray-200/80 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 sm:px-6 lg:px-8 md:flex-row md:items-center md:gap-4">
        <nav aria-label={`${hub.label} sections`} className="-mb-px flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {hub.tabs.map((tab) => {
            const active = isTabActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium transition-colors ${
                  active
                    ? "border-trust-600 text-trust-700"
                    : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        {activeTab?.hint && (
          <p className="pb-2 text-xs text-gray-500 md:ml-auto md:max-w-md md:truncate md:pb-0" title={activeTab.hint}>
            {activeTab.hint}
          </p>
        )}
      </div>
    </div>
  );
}
