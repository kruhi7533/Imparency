/**
 * The admin console's information architecture, in one place.
 *
 * The console grew page by page and the navigation grew with it — thirteen
 * flat links grouped by page TYPE ("Approvals", "Trust", "People") rather than
 * by where they sit in an organisation's life on the platform. So one stage
 * appeared as three separate destinations (NGO Verification, Document Review,
 * FCRA Review are all "is this organisation what it claims to be"), and the
 * order read as a list rather than as a sequence.
 *
 * A hub is one top-level destination with tabs inside it. Two rules:
 *   1. Top-level order follows the actual lifecycle — onboard, deliver, watch,
 *      respond — not alphabetical and not by when the page was built.
 *   2. Pages that answer the same question live in one hub, as tabs.
 *
 * Routes are unchanged. Every existing URL still works and still deep-links;
 * this only changes how they are grouped and reached.
 */

export interface HubTab {
  href: string;
  label: string;
  /** Shown under the tab bar so a hub explains itself without a manual. */
  hint?: string;
}

export interface Hub {
  /** Stable key, also used to pick the badge count in AdminNav. */
  key: string;
  label: string;
  /** Where the top-level nav link points — always the hub's first tab. */
  href: string;
  tabs: HubTab[];
}

export const ADMIN_HUBS: Hub[] = [
  {
    key: "today",
    label: "Today",
    href: "/admin/today",
    // No tabs: the inbox is one surface, and giving it a tab bar with a single
    // tab would be furniture pretending to be structure.
    tabs: [],
  },
  {
    key: "verification",
    label: "Verification",
    href: "/admin/verification",
    tabs: [
      {
        href: "/admin/verification",
        label: "Approvals",
        hint: "Approve or reject organisations. Approval requires evidence — no documents or unread documents means no Approve button.",
      },
      {
        href: "/admin/document-review",
        label: "Documents",
        hint: "The human gate on extracted fields. Only a validated field earns its compliance flag.",
      },
      {
        href: "/admin/fcra-review",
        label: "FCRA",
        hint: "Foreign-contribution certificates: approve, reject, and track expiry.",
      },
      {
        href: "/admin/requirements",
        label: "CSR requirements",
        hint: "Donor-submitted CSR requirements (uploaded documents or the structured form). Validate them before donors can match NGO projects against them.",
      },
    ],
  },
  {
    // Campaigns: the DONOR-led funding model. Organisations run campaigns that
    // raise money directly from donors and report milestone proof against it.
    // This is Project -> Donation/Milestone. The funder-led track (opportunities,
    // matching, proposals) is no longer an admin surface — it moves to the CSR and
    // NGO panels; see docs/WEEK5-FLOW.md. Its routes still exist and still work.
    key: "campaigns",
    label: "Campaigns",
    href: "/admin/project-review",
    tabs: [
      { href: "/admin/project-review", label: "Campaign approvals", hint: "Campaigns awaiting approval before they can raise funds from donors." },
      {
        href: "/admin/projects",
        label: "All Projects",
        hint: "Every campaign on the platform, searchable — active and completed ones live here too, not only what's still pending.",
      },
      { href: "/admin/proof-review", label: "Milestone proof", hint: "Evidence submitted against funded milestones." },
    ],
  },
  {
    key: "risk",
    label: "Risk",
    href: "/admin/risk-radar",
    tabs: [
      {
        href: "/admin/risk-radar",
        label: "Radar",
        hint: "Every entity scored and ranked, plus what the platform decided to do about each one.",
      },
      {
        href: "/admin/risk-compliance",
        label: "Reviews & alerts",
        hint: "Open risk reviews, the alerts behind them, and what the investigator found.",
      },
      // NOTE: /admin/fraud-alerts is NOT listed. It is a bare redirect to
      // risk-compliance, so giving it a tab put two entries in this hub that
      // land on the same page — the exact "one thing appearing as several"
      // problem the hubs were introduced to remove.
    ],
  },
  {
    key: "people",
    label: "People",
    href: "/admin/donors",
    tabs: [
      { href: "/admin/donors", label: "Donors", hint: "Donor accounts, giving history, and identity verification." },
      {
        href: "/admin/ngos",
        label: "Organisations",
        hint: "Every organisation on the platform, searchable. Verified ones live here too — the verification queue only ever shows those still pending.",
      },
      { href: "/admin/inquiries", label: "Inquiries", hint: "Donor questions waiting on an answer." },
    ],
  },
  {
    key: "insight",
    label: "Insight",
    href: "/admin/dashboard",
    tabs: [
      // The dashboard's metrics belong here, not in front of the approvals
      // queue that used to sit underneath them.
      { href: "/admin/dashboard", label: "Overview", hint: "Donations, verification counts, and platform totals." },
      { href: "/admin/trust-trends", label: "Trust trends", hint: "How verification and compliance are moving over time." },
      { href: "/admin/impact-health", label: "Impact health", hint: "Whether funded work is actually reporting outcomes." },
      {
        href: "/admin/sla",
        label: "Response targets",
        hint: "How long each queue is allowed to keep someone waiting, and what is currently past that.",
      },
      {
        href: "/admin/audit",
        label: "Audit trail",
        hint: "Every recorded admin decision, across every entity — searchable by actor, action, entity type, and date.",
      },
    ],
  },
];

/**
 * Which hub a path belongs to.
 *
 * Longest match wins so that a nested route (/admin/ngos/[id]) does not get
 * claimed by a hub whose href happens to be a shorter prefix.
 */
export function hubForPath(pathname: string | null): Hub | null {
  if (!pathname) return null;
  let best: { hub: Hub; length: number } | null = null;

  for (const hub of ADMIN_HUBS) {
    for (const tab of hub.tabs.length ? hub.tabs : [{ href: hub.href, label: hub.label }]) {
      if (pathname === tab.href || pathname.startsWith(tab.href + "/")) {
        if (!best || tab.href.length > best.length) best = { hub, length: tab.href.length };
      }
    }
  }

  return best?.hub ?? null;
}

export function isTabActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + "/");
}
