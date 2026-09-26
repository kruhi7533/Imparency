"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { hubForPath, isTabActive } from "./hubs";

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
export default function AdminTabs() {
  const pathname = usePathname();
  const hub = hubForPath(pathname);

  if (!hub || hub.tabs.length <= 1) return null;

  const activeTab = hub.tabs.find((t) => isTabActive(pathname, t.href));

  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          {hub.tabs.map((tab) => {
            const active = isTabActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`whitespace-nowrap px-3.5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                  active
                    ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                    : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-300"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {activeTab?.hint && (
        <div className="max-w-7xl mx-auto px-6 pb-2.5 -mt-px">
          <p className="text-xs text-gray-500 dark:text-gray-500">{activeTab.hint}</p>
        </div>
      )}
    </div>
  );
}
