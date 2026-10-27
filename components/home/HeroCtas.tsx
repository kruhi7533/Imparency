"use client";

import React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

/**
 * The homepage's call-to-action buttons, for whoever is looking.
 *
 * The page serves two sides of the platform, but the buttons used to be
 * "Browse campaigns" + "Register your NGO" for everyone: a visitor who came to
 * give or to fund through CSR had no way in, and a logged-in donor was invited
 * to register an NGO. A client component, so the page itself stays statically
 * rendered (ISR); only these buttons read the session.
 */

const PRIMARY =
  "group w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-trust-600 hover:bg-trust-700 text-white font-semibold px-6 py-3.5 rounded-xl text-sm shadow-sm shadow-trust-600/20 transition";
const SECONDARY =
  "w-full sm:w-auto inline-flex items-center justify-center bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 hover:border-gray-400 font-semibold px-6 py-3.5 rounded-xl text-sm transition";

type Cta = { href: string; label: string; primary?: boolean };

export function ctasFor(role: string | null | undefined): Cta[] {
  switch (role) {
    case "DONOR":
      return [
        { href: "/discover", label: "Browse campaigns", primary: true },
        { href: "/donor/dashboard", label: "Go to my dashboard" },
      ];
    case "NGO":
      return [
        { href: "/ngo/dashboard", label: "Go to NGO dashboard", primary: true },
        { href: "/ngo/projects/new", label: "Launch a project" },
      ];
    case "ADMIN":
      return [
        { href: "/admin/today", label: "Open admin console", primary: true },
        { href: "/discover", label: "Browse campaigns" },
      ];
    default:
      // Visitors: both sides of the platform, giving first.
      return [
        { href: "/discover", label: "Browse campaigns", primary: true },
        { href: "/login?mode=signup&role=DONOR", label: "Become a donor" },
        { href: "/ngo/register", label: "Register your NGO" },
      ];
  }
}

export default function HeroCtas() {
  const { data: session, status } = useSession();
  // While the session loads, show the visitor set rather than nothing, so the
  // hero never renders without a way forward.
  const role = status === "authenticated" ? session?.user?.role : null;

  return (
    <div className="flex flex-col sm:flex-row flex-wrap justify-center lg:justify-start items-center gap-3">
      {ctasFor(role).map((c) => (
        <Link key={c.href} href={c.href} className={c.primary ? PRIMARY : SECONDARY}>
          {c.label}
          {c.primary && (
            <span aria-hidden className="transition-transform motion-safe:group-hover:translate-x-0.5">
              →
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
