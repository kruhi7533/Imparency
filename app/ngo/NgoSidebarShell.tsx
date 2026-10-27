"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Activity,
  BarChart3,
  Building2,
  ClipboardList,
  FileSignature,
  Handshake,
  Inbox,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MessagesSquare,
  Rocket,
  Smartphone,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import PortalShell, { type PortalNavGroup } from "@/components/ui/PortalShell";
import type { NgoAttentionCounts } from "@/lib/ngo-attention";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean; badge?: keyof NgoAttentionCounts | "reporting" };
type Group = { label: string; items: Item[]; roles?: string[] };

// Who may see which group. Navigation only — every route still enforces its
// own permissions server-side (lib/tenant-scope.ts); hiding a link is a
// convenience, never the gate.
const MANAGERS = ["OWNER", "ADMIN", "PROGRAM_MANAGER"];
const FINANCE = ["OWNER", "ADMIN", "FINANCE"];

const GROUPS: Group[] = [
  { label: "Overview", items: [{ href: "/ngo/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true }], roles: [...MANAGERS, "FINANCE"] },
  {
    label: "Funding",
    roles: [...MANAGERS, "FINANCE"],
    items: [
      { href: "/ngo/match-inbox", label: "Match inbox", icon: Inbox, badge: "invitationsOpen" },
      { href: "/ngo/opportunities", label: "CSR opportunities", icon: Sparkles },
      { href: "/ngo/contracts", label: "Contracts", icon: FileSignature, badge: "paymentsToConfirm" },
    ],
  },
  { label: "Finance", roles: FINANCE, items: [{ href: "/ngo/bank-reconciliation", label: "Bank reconciliation", icon: Landmark }] },
  {
    label: "Delivery",
    items: [
      { href: "/ngo/projects/new", label: "Launch project", icon: Rocket, exact: true },
      { href: "/ngo/field", label: "Field app", icon: Smartphone, badge: "evidenceReturned" },
      { href: "/ngo/impact", label: "Impact", icon: BarChart3 },
      { href: "/ngo/reporting", label: "Reporting", icon: ClipboardList, badge: "reporting" },
    ],
  },
  {
    label: "Relationships",
    roles: MANAGERS,
    items: [
      { href: "/ngo/crm", label: "Donor CRM", icon: Handshake },
      { href: "/ngo/inquiries", label: "Inquiries", icon: MessagesSquare },
    ],
  },
  {
    label: "Organisation",
    roles: ["OWNER", "ADMIN"],
    items: [
      { href: "/ngo/settings/team", label: "Team", icon: Users },
      { href: "/ngo/settings/profile", label: "Organisation profile", icon: Building2 },
      { href: "/ngo/activity", label: "Activity log", icon: Activity },
    ],
  },
];

// Field staff see the Field app and nothing they cannot act on.
const FIELD_ONLY = new Set(["/ngo/field"]);

export default function NgoSidebarShell({
  teamRole,
  userName,
  orgName,
  counts,
  children,
}: {
  teamRole: string;
  userName: string;
  orgName: string | null;
  counts: NgoAttentionCounts | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  // Registration and resubmission are a single focused form; no portal chrome.
  if (pathname.startsWith("/ngo/register")) return <>{children}</>;

  const badgeFor = (key: Item["badge"]) => {
    if (!key || !counts) return undefined;
    if (key === "reporting") return counts.reportsReturned + counts.funderRequests;
    return counts[key];
  };

  const groups: PortalNavGroup[] = GROUPS.filter((g) => !g.roles || g.roles.includes(teamRole))
    .map((g) => ({
      label: g.label,
      items: (teamRole === "FIELD_STAFF" ? g.items.filter((i) => FIELD_ONLY.has(i.href)) : g.items).map((i) => ({
        href: i.href,
        label: i.label,
        icon: i.icon,
        exact: i.exact,
        badge: badgeFor(i.badge),
      })),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <PortalShell
      id="ngo-sidebar"
      ariaLabel="NGO portal"
      portalLabel={orgName ?? "NGO portal"}
      openLabel="Open NGO menu"
      groups={groups}
      user={{ name: userName, detail: teamRole === "OWNER" ? "Owner" : teamRole.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }}
      // NGO pages render their own <main>; avoid nesting landmarks.
      mainElement="div"
      footer={(close) => (
        <div className="space-y-2">
          <Link
            href="/help"
            onClick={close}
            className="flex items-start gap-3 rounded-xl bg-trust-50 p-3 text-xs text-trust-800 ring-1 ring-trust-100 hover:bg-trust-100"
          >
            <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-trust-600" aria-hidden="true" />
            <span>
              <span className="block font-semibold">Need help?</span>
              <span className="text-trust-700">Guides for milestones, proofs and reports.</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => {
              close();
              signOut({ callbackUrl: "/" });
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      )}
    >
      {children}
    </PortalShell>
  );
}
