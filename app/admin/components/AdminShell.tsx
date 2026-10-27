"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Inbox,
  ShieldCheck,
  Megaphone,
  AlertTriangle,
  Users,
  BarChart3,
  KeyRound,
  LifeBuoy,
  LogOut,
  ArrowLeft,
  Menu,
  X,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { hubForPath, hubsForRole } from "./hubs";
import AdminTabs from "./AdminTabs";
import AdminSearch from "./AdminSearch";
import AdminBell from "./AdminBell";
import { ADMIN_ROLE_LABEL, adminPageAllowed, effectiveAdminRole } from "@/lib/admin-roles";

const HUB_ICON: Record<string, LucideIcon> = {
  today: Inbox,
  verification: ShieldCheck,
  campaigns: Megaphone,
  risk: AlertTriangle,
  people: Users,
  insight: BarChart3,
  access: KeyRound,
};

const DASHBOARD = "/admin/dashboard";

export interface AdminShellProps {
  adminRole: string | null;
  userName: string | null;
  userEmail: string | null;
  /** Hub key → count needing attention (computed in the layout). */
  badges: Record<string, number>;
  children: React.ReactNode;
}

interface SideItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
}

/**
 * The admin console frame: a left sidebar (one entry per hub, from ./hubs.ts,
 * filtered by sub-role) and a top bar with search, notifications and the
 * account menu. Below lg the sidebar becomes an off-canvas drawer. The hub's
 * own tabs render as an in-page strip above the content (AdminTabs).
 */
export default function AdminShell({ adminRole, userName, userEmail, badges, children }: AdminShellProps) {
  const pathname = usePathname() ?? "";
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    drawerCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const role = effectiveAdminRole(adminRole);
  const roleLabel = ADMIN_ROLE_LABEL[role];
  const displayName = userName?.trim() || userEmail || "Admin";
  const initials =
    displayName
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join("") || "A";

  const onDashboard = pathname === DASHBOARD;
  const activeHub = onDashboard ? null : hubForPath(pathname);
  const hubs = hubsForRole(adminRole);

  const main: SideItem[] = [];
  if (adminPageAllowed(adminRole, DASHBOARD)) {
    main.push({ key: "dashboard", label: "Dashboard", href: DASHBOARD, icon: LayoutDashboard, active: onDashboard });
  }
  const consoleItems: SideItem[] = [];
  for (const hub of hubs) {
    // Insight's first tab IS the dashboard, which already has its own entry
    // above — so its sidebar link opens the hub's next tab instead.
    const href =
      hub.key === "insight" && hub.href === DASHBOARD ? hub.tabs.find((t) => t.href !== DASHBOARD)?.href ?? hub.href : hub.href;
    const item: SideItem = {
      key: hub.key,
      label: hub.key === "today" ? "Today inbox" : hub.label,
      href,
      icon: HUB_ICON[hub.key] ?? LayoutDashboard,
      active: activeHub?.key === hub.key,
      badge: badges[hub.key],
    };
    (hub.key === "today" ? main : consoleItems).push(item);
  }

  const sidebar = (
    <nav aria-label="Admin sections" className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <SideSection label="Main" items={main} />
        <SideSection label="Admin console" items={consoleItems} />
      </div>
      <div className="space-y-3 border-t border-gray-100 px-3 py-4">
        <div className="rounded-xl bg-trust-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-trust-900">
            <LifeBuoy className="h-4 w-4 text-trust-700" aria-hidden /> Need help?
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">Guides for verification, risk and finance workflows.</p>
          <a href="/help" className="mt-2 inline-block text-xs font-semibold text-trust-700 hover:text-trust-800">
            Open help centre →
          </a>
        </div>
        <a href="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to platform
        </a>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-700"
        >
          <LogOut className="h-4 w-4" aria-hidden /> Logout
        </button>
      </div>
    </nav>
  );

  return (
    <div className="text-gray-900">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>

      {/* Top bar */}
      <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-gray-200/80 bg-white px-4 sm:px-6 lg:pl-0">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Open navigation"
          aria-expanded={drawer}
          aria-controls="admin-drawer"
          className="grid h-10 w-10 place-items-center rounded-lg text-gray-700 hover:bg-gray-100 lg:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <Link
          href={adminPageAllowed(adminRole, DASHBOARD) ? DASHBOARD : hubs[0]?.href ?? "/admin"}
          className="flex shrink-0 items-baseline gap-2 lg:w-60 lg:px-6"
        >
          <span className="font-display text-xl font-semibold tracking-tight text-gray-900">
            ImpactBridge<span className="text-trust-600">.</span>
          </span>
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 xl:inline">Admin</span>
        </Link>

        <div className="hidden min-w-0 flex-1 md:block">
          {adminPageAllowed(adminRole, "/admin/search") && <AdminSearch />}
        </div>
        <div className="flex-1 md:hidden" />

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <AdminBell seeAllHref="/admin/notifications" />
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={`Account menu for ${displayName}`}
              className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-gray-100"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-trust-600 text-xs font-semibold text-white">{initials}</span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block max-w-[10rem] truncate text-sm font-semibold text-gray-900">{displayName}</span>
                <span className="block max-w-[10rem] truncate text-xs text-gray-500">{roleLabel}</span>
              </span>
              <ChevronDown className="hidden h-4 w-4 text-gray-500 sm:block" aria-hidden />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
                  {userEmail && <p className="truncate text-xs text-gray-500">{userEmail}</p>}
                  <p className="mt-1 text-xs font-medium text-trust-700">{roleLabel}</p>
                </div>
                <a role="menuitem" href="/" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  Back to platform
                </a>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Search on small screens sits under the bar */}
      {adminPageAllowed(adminRole, "/admin/search") && (
        <div className="border-b border-gray-200/80 bg-white px-4 py-2 md:hidden">
          <AdminSearch />
        </div>
      )}

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-gray-200/80 bg-white lg:block">
          <div className="sticky top-16 h-[calc(100vh-4rem)]">{sidebar}</div>
        </aside>

        {/* Mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation" id="admin-drawer">
            <div className="absolute inset-0 bg-gray-900/40" onClick={() => setDrawer(false)} aria-hidden />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
              <div className="flex h-16 items-center justify-between border-b border-gray-100 px-5">
                <span className="font-display text-xl font-semibold text-gray-900">
                  ImpactBridge<span className="text-trust-600">.</span>
                </span>
                <button
                  ref={drawerCloseRef}
                  type="button"
                  onClick={() => setDrawer(false)}
                  aria-label="Close navigation"
                  className="grid h-9 w-9 place-items-center rounded-lg text-gray-600 hover:bg-gray-100"
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1">{sidebar}</div>
            </aside>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {!onDashboard && <AdminTabs adminRole={adminRole} />}
          {role === "AUDITOR" && (
            <div role="status" className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs font-semibold text-amber-800">
              Read-only auditor access — you can view everything and export the audit trail; every change is refused by the server.
            </div>
          )}
          {/* The one <main> landmark for every admin page; pages use <div>. */}
          <main id="admin-main" className="min-w-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function SideSection({ label, items }: { label: string; items: SideItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <ul className="space-y-0.5">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.key}>
              <a
                href={it.href}
                aria-current={it.active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  it.active ? "bg-trust-50 text-trust-700" : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon className={`h-[18px] w-[18px] shrink-0 ${it.active ? "text-trust-600" : "text-gray-500 group-hover:text-gray-700"}`} aria-hidden />
                <span className="flex-1 truncate">{it.label}</span>
                {!!it.badge && it.badge > 0 && (
                  <span className="min-w-[20px] rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums leading-none text-white">
                    {it.badge > 99 ? "99+" : it.badge}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
