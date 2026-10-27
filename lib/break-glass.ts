import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-log";
import { effectiveAdminRole, type OrgRef } from "@/lib/admin-roles";

/**
 * ADM-020 — break-glass support access.
 *
 * A SUPPORT admin sees the queues but not one organisation's admin data. When a
 * ticket needs it, they open a grant for ONE organisation with a written
 * reason. The grant:
 *   - is time-boxed (default 60 min, hard cap MAX_MINUTES) and simply stops
 *     working at `expiresAt` — there is no job to forget to run;
 *   - can be revoked early by the holder or any SUPER admin;
 *   - makes every request under it leave a BREAK_GLASS_ACTION audit row
 *     (lib/auth-guards.ts and the org detail pages call `recordGrantUse`).
 * Audit rows carry ids, method and path only — never the reason text's
 * subject's PII; the reason itself lives on the grant row.
 */

export const DEFAULT_MINUTES = 60;
export const MAX_MINUTES = 60;
export const MIN_REASON = 15;

export class BreakGlassError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function grantIsActive(g: { expiresAt: Date; revokedAt: Date | null }, now = new Date()): boolean {
  return !g.revokedAt && g.expiresAt.getTime() > now.getTime();
}

export async function findActiveGrant(adminId: string, org: OrgRef, now = new Date()) {
  return prisma.breakGlassGrant.findFirst({
    where: { adminId, orgType: org.orgType, orgId: org.orgId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });
}

async function orgExists(org: OrgRef): Promise<boolean> {
  if (org.orgType === "NGO") return !!(await prisma.nGOProfile.findUnique({ where: { id: org.orgId }, select: { id: true } }));
  const u = await prisma.user.findUnique({ where: { id: org.orgId }, select: { role: true } });
  return u?.role === "DONOR";
}

export async function requestGrant(
  actor: { id: string; adminRole?: string | null },
  input: { orgType?: unknown; orgId?: unknown; reason?: unknown; minutes?: unknown },
  request?: Request
) {
  if (effectiveAdminRole(actor.adminRole) !== "SUPPORT") {
    throw new BreakGlassError("Only support admins request break-glass access; super admins already have it.", 403);
  }
  const orgType = input.orgType === "NGO" || input.orgType === "DONOR" ? input.orgType : null;
  const orgId = typeof input.orgId === "string" ? input.orgId.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!orgType || !orgId) throw new BreakGlassError("Choose the organisation (NGO or donor) and its id.", 400);
  if (reason.length < MIN_REASON) throw new BreakGlassError(`Give a reason of at least ${MIN_REASON} characters (e.g. the ticket number and what you need to do).`, 400);
  if (reason.length > 1000) throw new BreakGlassError("Keep the reason under 1000 characters.", 400);
  let minutes = DEFAULT_MINUTES;
  if (input.minutes !== undefined && input.minutes !== null && input.minutes !== "") {
    const n = Number(input.minutes);
    if (!Number.isInteger(n) || n < 5 || n > MAX_MINUTES) throw new BreakGlassError(`Duration must be 5–${MAX_MINUTES} minutes.`, 400);
    minutes = n;
  }
  const org: OrgRef = { orgType, orgId };
  if (!(await orgExists(org))) throw new BreakGlassError("Organisation not found.", 404);
  const existing = await findActiveGrant(actor.id, org);
  if (existing) throw new BreakGlassError("You already have an active grant for this organisation.", 409);

  const grant = await prisma.breakGlassGrant.create({
    data: { adminId: actor.id, orgType, orgId, reason, expiresAt: new Date(Date.now() + minutes * 60_000) },
  });
  await logAdminAction({
    adminId: actor.id,
    action: "BREAK_GLASS_GRANTED",
    entityType: "BREAK_GLASS_GRANT",
    entityId: grant.id,
    newValue: { orgType, orgId, expiresAt: grant.expiresAt.toISOString(), minutes },
    request,
  });
  return grant;
}

export async function revokeGrant(actor: { id: string; adminRole?: string | null }, grantId: string, request?: Request) {
  const grant = await prisma.breakGlassGrant.findUnique({ where: { id: grantId } });
  if (!grant) throw new BreakGlassError("Grant not found.", 404);
  const role = effectiveAdminRole(actor.adminRole);
  if (grant.adminId !== actor.id && role !== "SUPER") throw new BreakGlassError("Only the holder or a super admin can revoke this grant.", 403);
  if (!grantIsActive(grant)) throw new BreakGlassError("This grant has already ended.", 409);
  // Compare-and-swap: two revokes racing record one revocation.
  const { count } = await prisma.breakGlassGrant.updateMany({
    where: { id: grantId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: actor.id },
  });
  if (count === 0) throw new BreakGlassError("This grant has already ended.", 409);
  await logAdminAction({
    adminId: actor.id,
    action: "BREAK_GLASS_REVOKED",
    entityType: "BREAK_GLASS_GRANT",
    entityId: grantId,
    oldValue: { active: true },
    newValue: { active: false },
    request,
  });
}

/** Grants to show: SUPER/AUDITOR see everyone's, SUPPORT sees their own. Active first, then the last 50 ended. */
export async function listGrants(actor: { id: string; adminRole?: string | null }) {
  const role = effectiveAdminRole(actor.adminRole);
  const where = role === "SUPPORT" ? { adminId: actor.id } : {};
  const rows = await prisma.breakGlassGrant.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  const now = new Date();
  const adminIds = Array.from(new Set(rows.map((r) => r.adminId)));
  const admins = adminIds.length
    ? await prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } })
    : [];
  return rows.map((r) => ({
    id: r.id,
    adminId: r.adminId,
    adminName: admins.find((a) => a.id === r.adminId)?.name ?? "Admin",
    orgType: r.orgType,
    orgId: r.orgId,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    active: grantIsActive(r, now),
  }));
}

/**
 * Check + audit one use of a grant. Returns the grant id, or null when the
 * admin has no live grant for this org (caller refuses with 403).
 */
export async function recordGrantUse(adminId: string, org: OrgRef, use: { method: string; path: string }): Promise<string | null> {
  const grant = await findActiveGrant(adminId, org);
  if (!grant) return null;
  await logAdminAction({
    adminId,
    action: "BREAK_GLASS_ACTION",
    entityType: "BREAK_GLASS_GRANT",
    entityId: grant.id,
    metadata: { orgType: org.orgType, orgId: org.orgId, method: use.method, path: use.path },
  });
  return grant.id;
}
