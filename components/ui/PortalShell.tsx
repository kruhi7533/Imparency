"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, type LucideIcon } from "lucide-react";

export type PortalNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Short helper line under the label (optional). */
  subtitle?: string;
  /** A real count of work waiting behind this link; hidden when 0/undefined. */
  badge?: number;
  /** Override the default prefix matching. */
  isActive?: (pathname: string) => boolean;
  exact?: boolean;
};

export type PortalNavGroup = { label: string; items: PortalNavItem[] };

interface PortalShellProps {
  /** Accessible name of the sidebar landmark, e.g. "Donor portal". */
  ariaLabel: string;
  /** Small caps label above the identity block, e.g. "Donor portal". */
  portalLabel: string;
  /** Text of the mobile menu button's accessible name, e.g. "Open donor menu". */
  openLabel: string;
  id: string;
  groups: PortalNavGroup[];
  user: { name: string; detail?: string };
  /** Bottom-of-sidebar content (help card, sign out …). Receives a close() for the drawer. */
  footer?: (close: () => void) => React.ReactNode;
  children: React.ReactNode;
  /** Rendered as <main> unless the pages already provide their own main landmark. */
  mainElement?: "main" | "div";
}

/**
 * Light portal chrome shared by the NGO and donor portals: a white 240px
 * sidebar under the global navbar on lg+, and an off-canvas drawer opened from
 * a slim sticky bar below lg. One <aside> serves both, so the landmark name is
 * stable for tests and assistive tech.
 */
export default function PortalShell({
  ariaLabel,
  portalLabel,
  openLabel,
  id,
  groups,
  user,
  footer,
  children,
  mainElement = "main",
}: PortalShellProps) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  // Close on route change.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("overflow-hidden", "lg:overflow-auto");
    // Move focus into the drawer for keyboard users.
    asideRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("overflow-hidden", "lg:overflow-auto");
    };
  }, [open]);

  const isActive = (item: PortalNavItem) => {
    if (item.isActive) return item.isActive(pathname);
    const path = item.href.split("?")[0];
    return item.exact ? pathname === path : pathname === path || pathname.startsWith(path + "/");
  };

  const current = groups.flatMap((g) => g.items).find(isActive);
  const Main = mainElement;
  const initial = (user.name || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] bg-canvas">
      {open && (
        <div
          aria-hidden="true"
          className="fixed inset-0 top-16 z-40 bg-gray-900/30 lg:hidden print:hidden"
          onClick={close}
        />
      )}

      <aside
        id={id}
        ref={asideRef}
        aria-label={ariaLabel}
        className={`print:hidden fixed left-0 top-16 z-40 flex h-[calc(100vh-4rem)] w-[260px] flex-col border-r border-gray-200/80 bg-white transition-transform duration-200 ease-out motion-reduce:transition-none lg:sticky lg:z-auto lg:w-60 lg:shrink-0 lg:translate-x-0 lg:visible ${
          open ? "translate-x-0 shadow-xl" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-4">
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full bg-trust-50 text-sm font-semibold text-trust-700 ring-1 ring-trust-100"
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{portalLabel}</p>
            <p className="truncate text-sm font-semibold text-gray-900">{user.name}</p>
            {user.detail && <p className="truncate text-xs text-gray-500">{user.detail}</p>}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="-mr-1 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label={`${ariaLabel} sections`} className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((g, gi) => (
            <div key={g.label} className={gi > 0 ? "mt-5" : ""}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{g.label}</p>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = isActive(item);
                  const Icon = item.icon;
                  return (
                    <li key={item.href + item.label}>
                      <Link
                        href={item.href}
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                        className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-trust-50 font-semibold text-trust-700"
                            : "font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                        }`}
                      >
                        <Icon
                          className={`h-[18px] w-[18px] shrink-0 ${active ? "text-trust-600" : "text-gray-500 group-hover:text-gray-700"}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate leading-5">{item.label}</span>
                          {item.subtitle && (
                            <span className={`block truncate text-[11px] font-normal leading-4 ${active ? "text-trust-700/80" : "text-gray-500"}`}>
                              {item.subtitle}
                            </span>
                          )}
                        </span>
                        {!!item.badge && item.badge > 0 && (
                          <span
                            className="ml-auto inline-flex min-w-[1.25rem] justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-white"
                            aria-label={`${item.badge} waiting`}
                          >
                            {item.badge > 99 ? "99+" : item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {footer && <div className="border-t border-gray-100 p-3">{footer(close)}</div>}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Below lg: a slim bar under the global navbar opens the drawer. It is
            in the document flow, so nothing floats over page content. */}
        <div className="sticky top-16 z-30 flex h-12 items-center gap-3 border-b border-gray-200/80 bg-white/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/85 lg:hidden print:hidden">
          <button
            ref={buttonRef}
            type="button"
            aria-label={openLabel}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(true)}
            className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="truncate text-sm font-semibold text-gray-900">{current?.label ?? portalLabel}</span>
        </div>
        <Main className="min-w-0 flex-1">{children}</Main>
      </div>
    </div>
  );
}
