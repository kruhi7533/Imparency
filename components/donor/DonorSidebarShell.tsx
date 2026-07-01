"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

interface DonorSidebarShellProps {
  userName: string;
  userEmail: string;
  userId: string;
}

export function DonorSidebarShell({
  userName,
  userEmail,
  userId,
}: DonorSidebarShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Close mobile sidebar on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Prevent background body scrolling when mobileOpen is true
  useEffect(() => {
    if (mobileOpen) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
    return () => {
      document.body.classList.remove("overflow-hidden");
    };
  }, [mobileOpen]);

  // Close mobile sidebar when clicking outside of it (on the backdrop)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        mobileOpen &&
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target as Node) &&
        !(e.target as Element).closest(".mobile-hamburger-btn")
      ) {
        setMobileOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [mobileOpen]);

  // Active state matching rules
  const isItemActive = (route: string) => {
    const [routePath, routeQuery] = route.split("?");
    
    // Exception: /donor/donations can have any query string and still be active
    if (pathname === "/donor/donations" && routePath === "/donor/donations") {
      // If we are evaluating the Payment Tracking route specifically, check for status=FAILED
      if (routeQuery && new URLSearchParams(routeQuery).get("status") === "FAILED") {
        return searchParams.get("status") === "FAILED";
      }
      // Otherwise, the general Donation History item is active
      return true;
    }

    return pathname === routePath;
  };

  const navItems = [
    {
      label: "Impact Portfolio",
      subtitle: "Your giving story",
      route: "/donor/dashboard",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    },
    {
      label: "Donation History",
      subtitle: "All transactions",
      route: "/donor/donations",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      )
    },
    {
      label: "Payment Tracking",
      subtitle: "Failed & pending",
      route: "/donor/donations?status=FAILED",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      )
    },
    {
      label: "My Profile",
      subtitle: "Account & preferences",
      route: "/donor/profile",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      )
    },
    {
      label: "Help",
      subtitle: "Support & FAQs",
      route: "/help",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
  ];

  const nameInitial = userName.charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile Hamburger Button */}
      <button
        className="mobile-hamburger-btn fixed top-4 left-4 z-50 lg:hidden w-9 h-9 bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-center text-white focus:outline-none transition active:scale-95 shadow-sm"
        onClick={() => setMobileOpen(true)}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile Sidebar Backdrop Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar Panel Drawer */}
      <aside
        ref={sidebarRef}
        className={`fixed top-0 left-0 h-screen z-40 bg-gray-900 border-r border-gray-800 w-[240px] flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Sidebar Header / Wordmark */}
        <div className="p-6 border-b border-gray-800/80">
          <h2 className="text-lg font-black tracking-tight bg-gradient-to-r from-emerald-400 to-emerald-500 bg-clip-text text-transparent">
            IMPARENCY
          </h2>
          <span className="block text-[9px] font-bold text-gray-500 tracking-wider uppercase mt-0.5">
            Donor Portal
          </span>
        </div>

        {/* User Identity Section */}
        <div className="px-6 py-4 flex items-center gap-3 border-b border-gray-800/80">
          <div className="w-10 h-10 rounded-full bg-emerald-600 border border-emerald-500/25 text-white font-black text-sm flex items-center justify-center select-none shrink-0 shadow-inner shadow-black/10">
            {nameInitial}
          </div>
          <div className="min-w-0 text-left">
            <h3 className="text-xs font-bold text-white truncate leading-tight">
              {userName}
            </h3>
            <p className="text-[10px] text-gray-550 truncate mt-0.5">
              {userEmail}
            </p>
          </div>
        </div>

        {/* Navigation Section */}
        <div className="flex-1 overflow-y-auto py-5 space-y-4">
          <div className="px-6 text-[9px] font-bold tracking-widest text-gray-550 uppercase">
            My Account
          </div>

          <nav className="space-y-1 text-left">
            {navItems.map((item) => {
              const isActive = isItemActive(item.route);
              return (
                <Link
                  key={item.label}
                  href={item.route}
                  onClick={() => setMobileOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-2.5 rounded-xl mx-2
                    transition-all duration-150 group relative
                    ${isActive ? "bg-emerald-950/30 text-emerald-400 font-extrabold" : "text-gray-400 hover:bg-gray-800 hover:text-white"}
                  `}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-emerald-500 rounded-r-full" />
                  )}
                  <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold leading-none truncate">
                      {item.label}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5 truncate group-hover:text-gray-400">
                      {item.subtitle}
                    </div>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sign Out Section Pinned to Bottom */}
        <div className="p-4 border-t border-gray-800/80 mt-auto">
          <button
            onClick={() => {
              setMobileOpen(false);
              signOut({ callbackUrl: "/" });
            }}
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl mx-2 transition-all duration-150 w-full text-red-400 hover:bg-red-950/20 group text-left"
          >
            <span className="w-4 h-4 flex-shrink-0 text-red-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold leading-none truncate">
                Sign Out
              </div>
              <div className="text-[10px] text-red-400/50 mt-0.5 truncate group-hover:text-red-400/80">
                Exit session
              </div>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
}
