"use client";

import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

interface AdminNavProps {
  pendingProjectCount: number;
  unresolvedAlertsTotal: number;
  pendingCrisisCount?: number;
  inquiriesNeedingResponse: number;
}

interface NavLink {
  href: string;
  label: string;
  badge?: number;
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

export default function AdminNav({ pendingProjectCount, unresolvedAlertsTotal, pendingCrisisCount, inquiriesNeedingResponse }: AdminNavProps) {
  const pathname = usePathname();

  const groups: NavGroup[] = [
    {
      label: "Overview",
      links: [{ href: "/admin/today", label: "Today" }],
    },
    {
      label: "Approvals",
      links: [
        { href: "/admin/dashboard", label: "NGO Verification" },
        { href: "/admin/project-review", label: "Project Review", badge: pendingProjectCount },
        { href: "/admin/proof-review", label: "Proof Review" },
        { href: "/admin/fcra-review", label: "FCRA Review" },
        { href: "/admin/crisis", label: "Crisis Relief", badge: pendingCrisisCount },
        { href: "/admin/initiatives", label: "Relief Initiatives" },
      ],
    },
    {
      label: "Trust",
      links: [
        { href: "/admin/risk-compliance", label: "Risk & Compliance", badge: unresolvedAlertsTotal },
        { href: "/admin/trust-trends", label: "Trust Trends" },
        { href: "/admin/impact-health", label: "Impact Health" },
      ],
    },
    {
      label: "People",
      links: [
        { href: "/admin/donors", label: "Donors" },
        { href: "/admin/inquiries", label: "Inquiries", badge: inquiriesNeedingResponse },
      ],
    },
  ];

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

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

      <div className="max-w-7xl mx-auto mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
        {groups.map((group, i) => (
          <div key={group.label} className="flex items-center gap-x-6">
            {i > 0 && <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block" />}
            <div className="flex items-center gap-4 text-sm font-semibold">
              {group.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={
                    isActive(link.href)
                      ? "text-emerald-600 hover:text-emerald-700 transition underline decoration-2 underline-offset-4 flex items-center gap-1.5"
                      : "text-gray-500 hover:text-emerald-600 transition flex items-center gap-1.5"
                  }
                >
                  <span>{link.label}</span>
                  {!!link.badge && link.badge > 0 && (
                    <span className="bg-red-100 dark:bg-red-950/45 text-red-600 dark:text-red-400 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                      {link.badge}
                    </span>
                  )}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
