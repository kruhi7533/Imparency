/**
 * Admin sub-roles — who inside the platform team may do what.
 *
 * `Role.ADMIN` stays the platform role (every existing `verifySessionRole("ADMIN")`
 * keeps working). `User.adminRole` narrows it:
 *
 *   SUPER    (or null) everything — the behaviour every admin had before this existed
 *   FINANCE  reconciliation, finance exceptions, bank lines, allocations/payments only
 *   AUDITOR  reads everything under /admin, may export the audit trail, writes NOTHING
 *   SUPPORT  reads the queues; org-scoped admin data (an NGO's or a donor's admin
 *            routes) needs a live break-glass grant for that org (lib/break-glass.ts)
 *
 * This module is the single policy. It is PURE and edge-safe (no prisma, no
 * `node:` imports) because it runs in three places:
 *   - middleware.ts            API writes + /admin page access, from the JWT
 *   - lib/auth-guards.ts       every verifySessionRole() call, from the fresh session
 *   - app/admin nav            hides what the role cannot open
 * Policy is by path PATTERN, not by a route list, so a route another team adds
 * tomorrow is covered the day it lands: an unknown admin write is refused for
 * every restricted role.
 */

export const ADMIN_ROLES = ["SUPER", "FINANCE", "AUDITOR", "SUPPORT"] as const;
export type AdminRoleName = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABEL: Record<AdminRoleName, string> = {
  SUPER: "Super admin",
  FINANCE: "Admin — Finance",
  AUDITOR: "Admin — Auditor (read-only)",
  SUPPORT: "Admin — Support",
};

/** null/unknown on an ADMIN account means SUPER — every admin that predates sub-roles. */
export function effectiveAdminRole(raw: unknown): AdminRoleName {
  return typeof raw === "string" && (ADMIN_ROLES as readonly string[]).includes(raw) ? (raw as AdminRoleName) : "SUPER";
}

export function isRestrictedAdmin(raw: unknown): boolean {
  return effectiveAdminRole(raw) !== "SUPER";
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase());
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

/** API surface the FINANCE admin works in (any method). */
export const FINANCE_API_PREFIXES = ["/api/admin/finance", "/api/admin/allocations"];
/** Writes outside /api/admin any signed-in admin may still make (own session, own notifications). */
const SELF_SERVICE_WRITE_PREFIXES = ["/api/auth", "/api/user/notifications"];
/** Audit routes that only READ the trail even though some are POST (verify an uploaded export). */
const AUDIT_READ_ROUTES = ["/api/admin/audit/export", "/api/admin/audit/verify", "/api/admin/audit/verify-export"];
/** Admin-team management: SUPER writes; SUPER and AUDITOR read. */
const ADMIN_USERS_PREFIX = "/api/admin/users";
const BREAK_GLASS_API = "/api/admin/break-glass";

/** Org-scoped admin routes that SUPPORT may use only under a break-glass grant. */
const ORG_SCOPED_API = /^\/api\/admin\/(ngos|donors)\/([^/]+)(?:\/|$)/;
const ORG_SCOPED_PAGE = /^\/admin\/(ngos|donors)\/([^/]+)(?:\/|$)/;

export type OrgRef = { orgType: "NGO" | "DONOR"; orgId: string };

export function orgScopeOfPath(path: string): OrgRef | null {
  const m = ORG_SCOPED_API.exec(path) ?? ORG_SCOPED_PAGE.exec(path);
  if (!m) return null;
  return { orgType: m[1] === "ngos" ? "NGO" : "DONOR", orgId: decodeURIComponent(m[2]) };
}

export type AdminDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  /** Allowed only with a live break-glass grant for this org (checked against the DB by the caller). */
  | { kind: "grant"; org: OrgRef };

const ALLOW: AdminDecision = { kind: "allow" };
const deny = (reason: string): AdminDecision => ({ kind: "deny", reason });

/**
 * May an ADMIN with this sub-role call `method pathname` on the API?
 * Only consulted for `Role.ADMIN` sessions — other platform roles are untouched.
 */
export function adminApiDecision(rawRole: unknown, method: string, pathname: string): AdminDecision {
  const role = effectiveAdminRole(rawRole);
  if (role === "SUPER") return ALLOW;
  const read = isReadMethod(method);
  const path = pathname.replace(/\/+$/, "") || "/";

  if (SELF_SERVICE_WRITE_PREFIXES.some((p) => under(path, p))) return ALLOW;

  // Outside the admin API: restricted admins may read what any admin may read,
  // and change nothing (requirement admin actions, contracts, etc. are writes).
  if (!under(path, "/api/admin")) {
    return read ? ALLOW : deny(`${ADMIN_ROLE_LABEL[role]} cannot make changes here.`);
  }

  if (under(path, ADMIN_USERS_PREFIX)) {
    return read && role === "AUDITOR" ? ALLOW : deny("Only a super admin manages admin roles.");
  }

  switch (role) {
    case "AUDITOR":
      if (AUDIT_READ_ROUTES.some((p) => under(path, p))) return ALLOW;
      return read ? ALLOW : deny("Auditors have read-only access.");

    case "FINANCE":
      if (FINANCE_API_PREFIXES.some((p) => under(path, p))) return ALLOW;
      return deny("Finance admins can only use reconciliation, exceptions and payments.");

    case "SUPPORT": {
      if (under(path, BREAK_GLASS_API)) return ALLOW;
      const org = orgScopeOfPath(path);
      if (org && ORG_SCOPED_API.test(path)) return { kind: "grant", org };
      if (under(path, "/api/admin/audit")) return deny("Support admins cannot export the audit trail.");
      return read ? ALLOW : deny("Support admins need a break-glass grant to change an organisation's data.");
    }
  }
}

/** Pages a FINANCE admin may open. */
export const FINANCE_PAGE_PREFIXES = ["/admin/finance", "/admin/allocations", "/admin/contracts", "/admin/notifications"];

/** Where each role lands when it opens a page it cannot see. */
export function adminHome(rawRole: unknown): string {
  const role = effectiveAdminRole(rawRole);
  if (role === "FINANCE") return "/admin/finance";
  if (role === "SUPPORT") return "/admin/break-glass";
  return "/admin/dashboard";
}

/**
 * May this sub-role open this /admin page? SUPPORT on an org detail page returns
 * true here — the page itself checks the grant (it needs the DB).
 */
export function adminPageAllowed(rawRole: unknown, pathname: string): boolean {
  const role = effectiveAdminRole(rawRole);
  if (role === "SUPER" || role === "AUDITOR") return true;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (role === "FINANCE") return FINANCE_PAGE_PREFIXES.some((p) => under(path, p));
  // SUPPORT
  if (under(path, "/admin/audit") || under(path, "/admin/team")) return false;
  return true;
}

/** Button-level hint for UIs: may this role change anything at all on this page? */
export function adminCanWrite(rawRole: unknown, pathname: string): boolean {
  const role = effectiveAdminRole(rawRole);
  if (role === "SUPER") return true;
  if (role === "AUDITOR") return false;
  if (role === "FINANCE") return FINANCE_PAGE_PREFIXES.slice(0, 2).some((p) => under(pathname, p));
  return false;
}
