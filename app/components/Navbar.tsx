"use client";

import React from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

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
              <Link href="/ngo/dashboard" className={`hover:text-white transition ${pathname === "/ngo/dashboard" ? "text-white" : ""}`}>
                NGO Dashboard
              </Link>
              <Link href="/ngo/projects/new" className={`hover:text-white transition ${pathname === "/ngo/projects/new" ? "text-white" : ""}`}>
                Launch Project
              </Link>
              <span className="text-gray-700 select-none">|</span>
              <Link href="/discover" className={`text-gray-500 font-medium hover:text-gray-300 transition ${pathname === "/discover" ? "text-white font-bold" : ""}`}>
                Discover NGOs
              </Link>
            </>
          ) : (
            <>
              <Link href="/discover" className={`hover:text-white transition ${pathname === "/discover" ? "text-white" : ""}`}>
                Discover NGOs
              </Link>
              
              {/* Admin role specific links */}
              {session?.user?.role === "ADMIN" && (
                <Link href="/admin/dashboard" className={`hover:text-white transition ${pathname === "/admin/dashboard" ? "text-white" : ""}`}>
                  Admin Verifications
                </Link>
              )}

              {/* Fallback general links for guests / donors */}
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
            <div className="flex items-center gap-3">
              {/* User details */}
              <div className="hidden lg:block text-right">
                <div className="text-xs font-extrabold text-white truncate max-w-[150px]">{session.user.name}</div>
                <div className="text-[10px] text-gray-500 truncate max-w-[150px]">{session.user.email}</div>
              </div>
              
              {/* Profile Avatar Initials */}
              <div className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 font-bold flex items-center justify-center text-xs select-none">
                {(session.user.name || "U").charAt(0).toUpperCase()}
              </div>

              {/* Sign Out Action Button */}
              <button
                onClick={handleSignOut}
                className="border border-gray-800 hover:border-gray-700 bg-gray-900/50 hover:bg-gray-900 text-white font-bold py-2 px-4 rounded-xl text-xs transition"
              >
                Sign Out
              </button>
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
