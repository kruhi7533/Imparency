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

const PRIMARY = "w-full sm:w-auto bg-trust-600 hover:bg-trust-500 text-white font-semibold px-8 py-4 rounded-lg text-base transition";
const SECONDARY =
  "w-full sm:w-auto border border-trust-400/60 text-trust-100 hover:bg-trust-600/20 font-semibold px-8 py-4 rounded-lg text-base transition";

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
    <div className="flex flex-col sm:flex-row flex-wrap justify-center items-center gap-4">
      {ctasFor(role).map((c) => (
        <Link key={c.href} href={c.href} className={c.primary ? PRIMARY : SECONDARY}>
          {c.label}
        </Link>
      ))}
    </div>
  );
}
