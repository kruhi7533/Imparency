"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Activity,
  Bell,
  BarChart3,
  CreditCard,
  FileSignature,
  FileText,
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Newspaper,
  PieChart,
  Receipt,
  UserRound,
  Users,
} from "lucide-react";
import PortalShell, { type PortalNavGroup } from "@/components/ui/PortalShell";

interface DonorSidebarShellProps {
  userName: string;
  userEmail: string;
  userId: string;
  /** Real count of this donor's FAILED donations (badge on Payment Tracking). */
  failedPayments?: number;
  children: React.ReactNode;
}

export function DonorSidebarShell({ userName, userEmail, failedPayments = 0, children }: DonorSidebarShellProps) {
  const searchParams = useSearchParams();
  const failedView = searchParams?.get("status") === "FAILED";

  const groups: PortalNavGroup[] = [
    {
      label: "Main",
      items: [
        { label: "Dashboard", subtitle: "What needs you now", href: "/donor/dashboard", icon: LayoutDashboard },
        { label: "Impact Report", subtitle: "Verified outcomes · PDF/CSV", href: "/donor/impact-report", icon: BarChart3 },
        { label: "Impact Feed", subtitle: "Updates from projects", href: "/donor/impact", icon: Newspaper, exact: true },
        { label: "Impact Portfolio", subtitle: "Your giving story", href: "/donor/portfolio", icon: PieChart },
      ],
    },
    {
      label: "Giving",
      items: [
        {
          label: "Donation History",
          subtitle: "All transactions",
          href: "/donor/donations",
          icon: Receipt,
          isActive: (p) => (p === "/donor/donations" ? !failedView : p.startsWith("/donor/donations/")),
        },
        {
          label: "Payment Tracking",
          subtitle: "Failed & pending",
          href: "/donor/donations?status=FAILED",
          icon: CreditCard,
          badge: failedPayments,
          isActive: (p) => p === "/donor/donations" && failedView,
        },
      ],
    },
    {
      label: "CSR & grants",
      items: [
        { label: "CSR Requirements", subtitle: "Upload & review specs", href: "/donor/requirements", icon: FileText },
        { label: "Contracts & Grants", subtitle: "Milestone agreements", href: "/donor/contracts", icon: FileSignature },
        { label: "Team", subtitle: "Who acts for your organisation", href: "/donor/team", icon: Users },
      ],
    },
    {
      label: "Account",
      items: [
        { label: "Activity", subtitle: "Audit trail", href: "/donor/activity", icon: Activity },
        { label: "Notifications", subtitle: "Everything we told you", href: "/notifications", icon: Bell },
        { label: "My Profile", subtitle: "Account & preferences", href: "/donor/profile", icon: UserRound },
        { label: "Help", subtitle: "Support & FAQs", href: "/help", icon: HelpCircle },
      ],
    },
  ];

  return (
    <PortalShell
      id="donor-sidebar"
      ariaLabel="Donor portal"
      portalLabel="Donor portal"
      openLabel="Open donor menu"
      groups={groups}
      user={{ name: userName, detail: userEmail }}
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
              <span className="text-trust-700">Guides for receipts, contracts and reports.</span>
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
