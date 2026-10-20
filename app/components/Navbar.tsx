"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
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
  { href: "/ngo/bank-reconciliation", label: "Bank Reconciliation", match: "prefix" },
  { href: "/ngo/field", label: "Field App", match: "exact" },
];

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
  // Ten NGO links do not fit until xl; everyone else's few links fit from md.
  const desktopNav = role === "NGO" ? "hidden xl:flex" : "hidden md:flex";
  // On the donor portal the sidebar drawer is the navigation; a second menu
  // button would compete with it on a phone.
  const inDonorPortal = role === "DONOR" && !!pathname?.startsWith("/donor");
  const menuButton = inDonorPortal ? "hidden" : role === "NGO" ? "xl:hidden" : "md:hidden";

  // Hide Navbar inside the Login / Signup screen to keep it focused
  if (pathname === "/login") return null;

  const handleSignOut = () => {
    signOut({ callbackUrl: "/" });
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "ADMIN":
        return "bg-red-500/10 text-red-400 border border-red-500/25";
      case "NGO":
        return "bg-teal-500/10 text-teal-400 border border-teal-500/25";
      default:
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25";
    }
  };

  return (
    <header className="border-b border-gray-900 bg-gray-950/95 sticky top-0 z-50 print:hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">

        {/* Left: Branding Logo — shrink-0 + whitespace-nowrap so it can never
            be squeezed by the center nav on medium widths */}
        <div className="flex items-center gap-3 shrink-0">
          <Link href="/" className="font-display text-xl sm:text-2xl font-semibold italic text-white tracking-tight whitespace-nowrap">
            ImpactBridge<span className="text-gold-400">.</span>
          </Link>
          {session?.user && (
            <span className={`hidden sm:inline text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getRoleBadge(session.user.role)}`}>
              {session.user.role}
            </span>
          )}
        </div>

        {/* Center: Contextual Navigation Links */}
        <nav aria-label="Main" className={`${desktopNav} items-center gap-5 text-xs font-bold text-gray-400`}>
          {session?.user?.role === "NGO" ? (
            <>
              <Link href="/" className={`text-gray-500 font-medium hover:text-gray-300 transition ${pathname === "/" ? "text-white font-bold" : ""}`}>
                Home
              </Link>
              <Link href="/discover" className={`text-gray-500 font-medium hover:text-gray-300 transition ${pathname === "/discover" ? "text-white font-bold" : ""}`}>
                Discover NGOs
              </Link>
              <span className="text-gray-700 select-none">|</span>
              {NGO_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive(l) ? "page" : undefined}
                  className={`hover:text-white transition whitespace-nowrap ${isActive(l) ? "text-white" : ""}`}
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
              {session?.user?.role === "ADMIN" && (
                <Link
                  href="/admin/today"
                  className={`px-3.5 py-1.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200 transition ${
                    pathname.startsWith("/admin") ? "bg-red-500/20 text-red-200" : ""
                  }`}
                >
                  Admin Console →
                </Link>
              )}

              {session?.user?.role !== "ADMIN" && (
                <>
                  <Link href="/" className={`hover:text-white transition ${pathname === "/" ? "text-white" : ""}`}>
                    Home
                  </Link>
                  <Link href="/discover" className={`hover:text-white transition ${pathname === "/discover" ? "text-white" : ""}`}>
                    Discover NGOs
                  </Link>
                </>
              )}

              {/* Donor role specific links */}
              {session?.user?.role === "DONOR" && (
                <>
                  <Link href="/donor/portfolio" className={`hover:text-white transition ${pathname === "/donor/portfolio" ? "text-white" : ""}`}>
                    My Impact Portfolio
                  </Link>
                  <Link href="/donor/impact" className={`hover:text-white transition ${pathname === "/donor/impact" ? "text-white" : ""}`}>
                    Impact Feed
                  </Link>
                </>
              )}

              {/* Guests get real parity: a path to give AND a path to raise —
                  not just the NGO side of the platform */}
              {!session?.user && (
                <>
                  <Link href="/login" className={`hover:text-white transition ${pathname === "/login" ? "text-white" : ""}`}>
                    Become a Donor
                  </Link>
                  <Link href="/ngo/register" className={`hover:text-white transition ${pathname === "/ngo/register" ? "text-white" : ""}`}>
                    NGO Onboarding
                  </Link>
                </>
              )}
            </>
          )}
        </nav>

        {/* Right: Authentication Session Controls */}
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className={`${menuButton} w-10 h-10 flex items-center justify-center rounded-lg text-gray-300 hover:text-white hover:bg-gray-900 transition`}
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
            <div className="h-8 w-8 animate-pulse bg-gray-900 rounded-full" />
          ) : session?.user ? (
            <div className="flex items-center gap-3 relative">
              <NotificationBell />
              {/* User details */}
              <div className="hidden lg:block text-right">
                <div className="text-xs font-extrabold text-white truncate max-w-[150px]">{session.user.name}</div>
                <div className="text-[10px] text-gray-500 truncate max-w-[150px]">{session.user.email}</div>
              </div>

              {/* Profile Avatar Initials Trigger */}
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                aria-label="Account menu"
                className="w-10 h-10 rounded-full bg-trust-600/20 border border-trust-500/30 text-trust-300 font-bold flex items-center justify-center text-xs select-none hover:bg-trust-600/30 transition focus:outline-none relative overflow-hidden"
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
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute right-0 top-full mt-2 w-48 bg-gray-950 border border-gray-800 rounded-xl shadow-xl py-2 z-20 origin-top-right"
                  >
                    {session.user.role === "DONOR" && (
                      <Link
                        href="/donor/profile"
                        onClick={() => setDropdownOpen(false)}
                        className="block px-4 py-2 text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-900 transition"
                      >
                        Profile
                      </Link>
                    )}
                    {session.user.role === "NGO" && (
                      <>
                        <Link
                          href="/ngo/settings/profile"
                          onClick={() => setDropdownOpen(false)}
                          className="block px-4 py-2 text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-900 transition"
                        >
                          My Profile
                        </Link>
                        <Link
                          href="/ngo/settings/team"
                          onClick={() => setDropdownOpen(false)}
                          className="block px-4 py-2 text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-900 transition"
                        >
                          Team Settings
                        </Link>
                        <Link
                          href="/ngo/activity"
                          onClick={() => setDropdownOpen(false)}
                          className="block px-4 py-2 text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-900 transition"
                        >
                          Activity &amp; Audit
                        </Link>
                        <Link
                          href="/ngo/pitch-deck"
                          onClick={() => setDropdownOpen(false)}
                          className="block px-4 py-2 text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-900 transition flex items-center justify-between"
                        >
                          Pitch Deck
                          <span className="bg-emerald-500/20 text-emerald-400 text-[9px] uppercase px-1.5 py-0.5 rounded-full font-bold leading-none">New</span>
                        </Link>
                      </>
                    )}
                    {session.user.role === "ADMIN" && (
                      <>
                        <Link
                          href="/admin/today"
                          onClick={() => setDropdownOpen(false)}
                          className="block px-4 py-2 text-xs font-bold text-red-300 hover:text-red-200 hover:bg-gray-900 transition"
                        >
                          Go to Admin Panel
                        </Link>
                        <div className="border-t border-gray-900 my-1"></div>
                      </>
                    )}
                    <Link
                      href="/help"
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-900 transition"
                    >
                      Help
                    </Link>
                    <div className="border-t border-gray-900 my-1"></div>
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        handleSignOut();
                      }}
                      className="w-full text-left block px-4 py-2 text-xs font-bold text-red-400 hover:text-red-300 hover:bg-gray-900 transition"
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
                className="bg-trust-600 hover:bg-trust-500 text-white font-semibold py-2 px-4 rounded-lg text-xs transition"
              >
                Sign In / Register
              </Link>
            </div>
          )}
        </div>

      </div>

      {menuOpen && (
        <nav id="mobile-nav" aria-label="Main" className={`${menuButton} border-t border-gray-900 bg-gray-950 px-4 py-3`}>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {menuLinks.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={isActive(l) ? "page" : undefined}
                  className={`block px-3 py-3 rounded-lg text-sm font-bold transition ${isActive(l) ? "bg-gray-900 text-white" : "text-gray-400 hover:text-white hover:bg-gray-900"}`}
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
