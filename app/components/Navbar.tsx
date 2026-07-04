"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { ShieldCheck, MessageCircleQuestion, Users, HeartPulse, ListChecks, TrendingUp } from "lucide-react";

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);

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
    <header className="border-b border-gray-900 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Left: Branding Logo */}
        <div className="flex items-center gap-3">
          <Link href="/" className="text-2xl font-black bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent tracking-tight">
            ImpactBridge
          </Link>
          {session?.user && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getRoleBadge(session.user.role)}`}>
              {session.user.role}
            </span>
          )}
        </div>

        {/* Center: Contextual Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-bold text-gray-400">
          {session?.user?.role === "NGO" ? (
            <>
              <Link href="/" className={`text-gray-500 font-medium hover:text-gray-300 transition ${pathname === "/" ? "text-white font-bold" : ""}`}>
                Home
              </Link>
              <Link href="/discover" className={`text-gray-500 font-medium hover:text-gray-300 transition ${pathname === "/discover" ? "text-white font-bold" : ""}`}>
                Discover NGOs
              </Link>
              <span className="text-gray-700 select-none">|</span>
              <Link href="/ngo/dashboard" className={`hover:text-white transition ${pathname === "/ngo/dashboard" ? "text-white" : ""}`}>
                NGO Dashboard
              </Link>
              <Link href="/ngo/crm" className={`hover:text-white transition ${pathname === "/ngo/crm" ? "text-white" : ""}`}>
                Donor CRM
              </Link>
              <Link href="/ngo/projects/new" className={`hover:text-white transition ${pathname === "/ngo/projects/new" ? "text-white" : ""}`}>
                Launch Project
              </Link>
              <Link href="/ngo/inquiries" className={`hover:text-white transition ${pathname === "/ngo/inquiries" ? "text-white" : ""}`}>
                Inquiries
              </Link>
            </>
          ) : (
            <>
              <Link href="/" className={`hover:text-white transition ${pathname === "/" ? "text-white" : ""}`}>
                Home
              </Link>
              <Link href="/discover" className={`hover:text-white transition ${pathname === "/discover" ? "text-white" : ""}`}>
                Discover NGOs
              </Link>

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
              
              {/* Admin role specific links — grouped as one visual "console" so it
                  reads as a distinct workspace, not more items in a flat list */}
              {session?.user?.role === "ADMIN" && (
                <div className="flex items-center flex-wrap gap-1 bg-white/5 border border-white/10 rounded-full p-1">
                  {[
                    { href: "/admin/today", label: "Today", icon: ListChecks, match: (p: string) => p === "/admin/today" },
                    { href: "/admin/dashboard", label: "Verifications", icon: ShieldCheck, match: (p: string) => p === "/admin/dashboard" },
                    { href: "/admin/inquiries", label: "Inquiries", icon: MessageCircleQuestion, match: (p: string) => p === "/admin/inquiries" },
                    { href: "/admin/donors", label: "Donors", icon: Users, match: (p: string) => p.startsWith("/admin/donors") },
                    { href: "/admin/impact-health", label: "Impact Health", icon: HeartPulse, match: (p: string) => p === "/admin/impact-health" },
                    { href: "/admin/trust-trends", label: "Trends", icon: TrendingUp, match: (p: string) => p === "/admin/trust-trends" },
                  ].map(({ href, label, icon: Icon, match }) => {
                    const active = match(pathname);
                    return (
                      <Link
                        key={href}
                        href={href}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
                          active
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "text-gray-400 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        <Icon size={14} strokeWidth={2.5} />
                        {label}
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* Fallback general links for guests */}
              {!session?.user && (
                <Link href="/ngo/register" className={`hover:text-white transition ${pathname === "/ngo/register" ? "text-white" : ""}`}>
                  NGO Onboarding
                </Link>
              )}
            </>
          )}
        </nav>

        {/* Right: Authentication Session Controls */}
        <div className="flex items-center gap-4">
          {status === "loading" ? (
            <div className="h-8 w-8 animate-pulse bg-gray-900 rounded-full" />
          ) : session?.user ? (
            <div className="flex items-center gap-3 relative">
              {/* User details */}
              <div className="hidden lg:block text-right">
                <div className="text-xs font-extrabold text-white truncate max-w-[150px]">{session.user.name}</div>
                <div className="text-[10px] text-gray-500 truncate max-w-[150px]">{session.user.email}</div>
              </div>
              
              {/* Profile Avatar Initials Trigger */}
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 font-bold flex items-center justify-center text-xs select-none hover:bg-emerald-650/30 transition focus:outline-none relative overflow-hidden"
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
              >
                {session.user.image ? (
                  <img src={session.user.image} alt={session.user.name || "User"} className="w-full h-full object-cover" />
                ) : (
                  (session.user.name || "U").charAt(0).toUpperCase()
                )}
              </button>

              {/* Dropdown Menu */}
              {dropdownOpen && (
                <>
                  {/* Backdrop overlay to close on outside click */}
                  <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)}></div>
                  
                  <div className="absolute right-0 top-full mt-2 w-48 bg-gray-950 border border-gray-900 rounded-xl shadow-xl py-2 z-20 animate-fadeIn origin-top-right">
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
                          href="/ngo/pitch-deck"
                          onClick={() => setDropdownOpen(false)}
                          className="block px-4 py-2 text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-900 transition flex items-center justify-between"
                        >
                          Pitch Deck
                          <span className="bg-emerald-500/20 text-emerald-400 text-[9px] uppercase px-1.5 py-0.5 rounded-full font-bold leading-none">New</span>
                        </Link>
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
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2 px-4 rounded-xl text-xs shadow-md shadow-emerald-500/10 transition"
              >
                Sign In / Register
              </Link>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
