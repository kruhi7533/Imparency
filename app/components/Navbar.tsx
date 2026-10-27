"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Search } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import NotificationBell from "./NotificationBell";

type NavLink = { href: string; label: string; match: "exact" | "prefix" };

/** The NGO workspace. One list drives the desktop bar and the small-screen menu. */
const NGO_LINKS: NavLink[] = [
  { href: "/ngo/dashboard", label: "NGO Dashboard", match: "exact" },
  { href: "/ngo/crm", label: "Donor CRM", match: "exact" },
  { href: "/ngo/projects/new", label: "Launch Project", match: "exact" },
  { href: "/ngo/match-inbox", label: "Match Inbox", match: "exact" },
  { href: "/ngo/inquiries", label: "Inquiries", match: "exact" },
  { href: "/ngo/opportunities", label: "CSR Opportunities", match: "prefix" },
  { href: "/ngo/contracts", label: "Contracts", match: "prefix" },
  { href: "/ngo/impact", label: "Impact", match: "prefix" },
  { href: "/ngo/reporting", label: "Reporting", match: "prefix" },
  { href: "/ngo/bank-reconciliation", label: "Bank Reconciliation", match: "prefix" },
  { href: "/ngo/field", label: "Field App", match: "exact" },
];

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const isActive = (l: NavLink) => (l.match === "exact" ? pathname === l.href : !!pathname?.startsWith(l.href));
  const role = session?.user?.role;
  // What the small-screen menu lists for this visitor. Below the breakpoint the
  // centre bar is hidden, so this menu is the only way around on a phone — a
  // field worker must be able to reach the Field App without typing a URL.
  const menuLinks: NavLink[] =
    role === "NGO"
      ? [{ href: "/", label: "Home", match: "exact" }, { href: "/discover", label: "Discover NGOs", match: "exact" }, ...NGO_LINKS]
      : role === "ADMIN"
      ? [{ href: "/admin/today", label: "Admin Console", match: "prefix" }]
      : role === "DONOR"
      ? [
          { href: "/", label: "Home", match: "exact" },
          { href: "/discover", label: "Discover NGOs", match: "exact" },
          { href: "/donor/portfolio", label: "My Impact Portfolio", match: "exact" },
          { href: "/donor/impact", label: "Impact Feed", match: "exact" },
        ]
      : [
          { href: "/", label: "Home", match: "exact" },
          { href: "/discover", label: "Discover NGOs", match: "exact" },
          { href: "/login", label: "Become a Donor", match: "exact" },
          { href: "/ngo/register", label: "NGO Onboarding", match: "exact" },
        ];
  // The NGO workspace has twelve links (Home, Discover + ten tools). The header
  // content is capped at ~1216px (max-w-7xl), so they never fit inline at ANY
  // screen size: showing them from xl overflowed and pushed the logo off-screen
  // whenever the window was wide (e.g. browser zoom below 100%). So for NGOs the
  // whole navigation lives behind the menu button at every width; everyone
  // else's few links fit inline from md.
  const desktopNav = role === "NGO" ? "hidden" : "hidden md:flex";
  // On the donor portal the sidebar drawer is the navigation; a second menu
  // button would compete with it on a phone.
  const inDonorPortal = role === "DONOR" && !!pathname?.startsWith("/donor");
  // Inside the NGO portal its sidebar drawer is the menu; a second hamburger
  // here would give phones two menu buttons.
  const inNgoPortal = role === "NGO" && !!pathname?.startsWith("/ngo") && !pathname.startsWith("/ngo/register");
  const menuButton = inDonorPortal || inNgoPortal ? "hidden" : role === "NGO" ? "" : "md:hidden";

  // Hide Navbar inside the Login / Signup screen to keep it focused
  if (pathname === "/login") return null;
  // The admin console has its own top bar (app/admin/components/AdminShell.tsx).
  if (pathname?.startsWith("/admin")) return null;

  const handleSignOut = () => {
    signOut({ callbackUrl: "/" });
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "ADMIN":
        return "bg-red-50 text-red-700 ring-1 ring-red-200";
      case "NGO":
        return "bg-teal-50 text-teal-700 ring-1 ring-teal-200";
      default:
        return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    }
  };

  const linkCls = (active: boolean) =>
    `relative py-1 whitespace-nowrap transition-colors ${
      active
        ? "text-trust-700 after:absolute after:inset-x-0 after:-bottom-[21px] after:h-0.5 after:bg-trust-600 after:rounded-full"
        : "text-gray-600 hover:text-gray-900"
    }`;
  const menuItemCls =
    "block px-4 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition";

  return (
    <header className="border-b border-gray-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 sticky top-0 z-50 print:hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">

        {/* Left: Branding Logo — shrink-0 + whitespace-nowrap so it can never
            be squeezed by the center nav on medium widths */}
        <div className="flex items-center gap-3 shrink-0">
          <Link href="/" className="font-display text-xl sm:text-2xl font-semibold text-gray-900 tracking-tight whitespace-nowrap">
            ImpactBridge<span className="text-trust-600">.</span>
          </Link>
          {session?.user && (
            <span className={`hidden sm:inline text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${getRoleBadge(session.user.role)}`}>
              {session.user.role}
            </span>
          )}
        </div>

        {/* Center: Contextual Navigation Links */}
        <nav aria-label="Main" className={`${desktopNav} items-center gap-6 text-sm font-medium`}>
          {session?.user?.role === "NGO" ? (
            <>
              <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={linkCls(pathname === "/")}>
                Home
              </Link>
              <Link href="/discover" aria-current={pathname === "/discover" ? "page" : undefined} className={linkCls(pathname === "/discover")}>
                Discover NGOs
              </Link>
              <span className="text-gray-300 select-none">|</span>
              {NGO_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive(l) ? "page" : undefined}
                  className={linkCls(isActive(l))}
                >
                  {l.label}
                </Link>
              ))}
            </>
          ) : (
            <>
              {/* Admin gets ONE door into the console, not the old flat menu.
                  The full navigation lives in the Admin Console hub bar
                  (app/admin/layout.tsx); this single link is just the way in
                  from the public site, so an admin who lands on the home page
                  isn't stranded with only the donor/NGO CTAs. */}
              {session?.user?.role === "ADMIN" && !pathname.startsWith("/admin") && (
                <Link
                  href="/admin/today"
                  className="px-3.5 py-1.5 rounded-full bg-trust-50 text-trust-700 ring-1 ring-trust-200 hover:bg-trust-100 transition"
                >
                  Admin Console →
                </Link>
              )}

              {session?.user?.role !== "ADMIN" && (
                <>
                  <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={linkCls(pathname === "/")}>
                    Home
                  </Link>
                  <Link href="/discover" aria-current={pathname === "/discover" ? "page" : undefined} className={linkCls(pathname === "/discover")}>
                    Discover NGOs
                  </Link>
                </>
              )}

              {/* Donor role specific links */}
              {session?.user?.role === "DONOR" && (
                <>
                  <Link href="/donor/portfolio" aria-current={pathname === "/donor/portfolio" ? "page" : undefined} className={linkCls(pathname === "/donor/portfolio")}>
                    My Impact Portfolio
                  </Link>
                  <Link href="/donor/impact" aria-current={pathname === "/donor/impact" ? "page" : undefined} className={linkCls(pathname === "/donor/impact")}>
                    Impact Feed
                  </Link>
                </>
              )}

              {/* Guests get real parity: a path to give AND a path to raise —
                  not just the NGO side of the platform */}
              {!session?.user && (
                <>
                  <Link href="/login" className={linkCls(false)}>
                    Become a Donor
                  </Link>
                  <Link href="/ngo/register" aria-current={pathname === "/ngo/register" ? "page" : undefined} className={linkCls(pathname === "/ngo/register")}>
                    NGO Onboarding
                  </Link>
                  <Link href="/#how-it-works" className={`hidden lg:inline ${linkCls(false)}`}>
                    How it works
                  </Link>
                  <Link href="/#stories" className={`hidden lg:inline ${linkCls(false)}`}>
                    Impact Stories
                  </Link>
                </>
              )}
            </>
          )}
        </nav>

        {/* Right: Authentication Session Controls */}
        <div className="flex items-center gap-1.5 sm:gap-3">
          {role !== "NGO" && role !== "ADMIN" && (
            <Link
              href="/discover"
              aria-label="Search NGOs and campaigns"
              className="hidden sm:flex w-10 h-10 items-center justify-center rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition"
            >
              <Search className="w-[18px] h-[18px]" aria-hidden="true" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className={`${menuButton} w-10 h-10 flex items-center justify-center rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition`}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              {menuOpen ? (
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
          {status === "loading" ? (
            <div className="h-9 w-9 animate-pulse bg-gray-100 rounded-full" />
          ) : session?.user ? (
            <div className="flex items-center gap-2 sm:gap-3 relative">
              <NotificationBell />
              {/* User details */}
              <div className="hidden lg:block text-right">
                <div className="text-sm font-semibold text-gray-900 truncate max-w-[160px]">{session.user.name}</div>
                <div className="text-[11px] text-gray-500 truncate max-w-[160px]">{session.user.email}</div>
              </div>

              {/* Profile Avatar Initials Trigger */}
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                aria-label="Account menu"
                className="w-10 h-10 rounded-full bg-trust-50 ring-1 ring-trust-200 text-trust-700 font-semibold flex items-center justify-center text-sm select-none hover:bg-trust-100 transition relative overflow-hidden"
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
              >
                {session.user.image ? (
                  <img src={session.user.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  (session.user.name || "U").charAt(0).toUpperCase()
                )}
              </button>

              {/* Dropdown Menu */}
              <AnimatePresence>
              {dropdownOpen && (
                <>
                  {/* Backdrop overlay to close on outside click */}
                  <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)}></div>

                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg shadow-gray-900/5 py-2 z-20 origin-top-right"
                  >
                    <div className="px-4 pb-2 mb-1 border-b border-gray-100 lg:hidden">
                      <div className="text-sm font-semibold text-gray-900 truncate">{session.user.name}</div>
                      <div className="text-[11px] text-gray-500 truncate">{session.user.email}</div>
                    </div>
                    {session.user.role === "DONOR" && (
                      <Link href="/donor/profile" onClick={() => setDropdownOpen(false)} className={menuItemCls}>
                        Profile
                      </Link>
                    )}
                    {session.user.role === "NGO" && (
                      <>
                        <Link href="/ngo/settings/profile" onClick={() => setDropdownOpen(false)} className={menuItemCls}>
                          My Profile
                        </Link>
                        <Link href="/ngo/settings/team" onClick={() => setDropdownOpen(false)} className={menuItemCls}>
                          Team Settings
                        </Link>
                        <Link href="/ngo/activity" onClick={() => setDropdownOpen(false)} className={menuItemCls}>
                          Activity &amp; Audit
                        </Link>
                        <Link
                          href="/ngo/pitch-deck"
                          onClick={() => setDropdownOpen(false)}
                          className={`${menuItemCls} flex items-center justify-between`}
                        >
                          Pitch Deck
                          <span className="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-[9px] uppercase px-1.5 py-0.5 rounded-full font-semibold leading-none">New</span>
                        </Link>
                      </>
                    )}
                    {session.user.role === "ADMIN" && (
                      <>
                        <Link
                          href="/admin/today"
                          onClick={() => setDropdownOpen(false)}
                          className="block px-4 py-2 text-sm font-medium text-trust-700 hover:bg-trust-50 transition"
                        >
                          Go to Admin Panel
                        </Link>
                        <div className="border-t border-gray-100 my-1"></div>
                      </>
                    )}
                    <Link href="/help" onClick={() => setDropdownOpen(false)} className={menuItemCls}>
                      Help
                    </Link>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        handleSignOut();
                      }}
                      className="w-full text-left block px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 transition"
                    >
                      Sign Out
                    </button>
                  </motion.div>
                </>
              )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="bg-trust-600 hover:bg-trust-700 text-white font-semibold py-2 px-3 sm:px-4 rounded-lg text-sm shadow-sm transition whitespace-nowrap"
              >
                Sign In / Register
              </Link>
            </div>
          )}
        </div>

      </div>

      {menuOpen && (
        <nav id="mobile-nav" aria-label="Main" className={`${menuButton} border-t border-gray-200 bg-white px-4 py-3 shadow-sm`}>
          <ul className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1">
            {menuLinks.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={isActive(l) ? "page" : undefined}
                  className={`block px-3 py-3 rounded-lg text-sm font-medium transition ${isActive(l) ? "bg-trust-50 text-trust-700" : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"}`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
