import { NextResponse } from "next/server";
import type { TeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * The tenant boundary, in one place (ADM-019 / NEG-001 / NEG-002).
 *
 * The tenant is the ORGANISATION: an `NGOProfile` for NGOs, the donor account
 * (owner's user id, lib/donor-team.ts) for donors/CSR. There is deliberately
 * no separate programme-tenant model. A person reaches an NGO's rows only by
 * being its owner (`NGOProfile.userId`) or an `NGOTeamMember` of it — never
 * because the JWT happens to carry an `ngoProfileId` (that value is a hint for
 * UI routing and can be stale; membership is re-read here on every call).
 *
 * `tests/tenant-isolation-coverage.test.ts` enumerates every org-owned route
 * and fails when one neither uses an ownership helper nor is listed with a
 * reason — so a new route that forgets the check fails CI, not a pen test.
 */

export type NgoCapability =
  /** See the org's projects, tasks, contracts (non-finance detail). */
  | "view"
  /** Invite, change and remove team members. */
  | "manageTeam"
  /** Create/assign field tasks and see everyone's tasks. */
  | "assignTasks"
  /** Bank statements, payment confirmation, budgets: anything money. */
  | "finance"
  /** Edit projects, proposals, outcome claims, reply to donors/admins on behalf of the org. */
  | "manageProgramme";

export const NGO_CAN: Record<NgoCapability, TeamRole[]> = {
  view: ["OWNER", "ADMIN", "PROGRAM_MANAGER", "FINANCE", "FIELD_STAFF"],
  manageTeam: ["OWNER", "ADMIN"],
  assignTasks: ["OWNER", "ADMIN", "PROGRAM_MANAGER"],
  finance: ["OWNER", "ADMIN", "FINANCE"],
  manageProgramme: ["OWNER", "ADMIN", "PROGRAM_MANAGER"],
};

export function ngoCan(role: TeamRole, cap: NgoCapability): boolean {
  return NGO_CAN[cap].includes(role);
}

/** Seniority for "nobody can grant a role above their own". FINANCE and PROGRAM_MANAGER are peers. */
export const TEAM_ROLE_RANK: Record<TeamRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  PROGRAM_MANAGER: 2,
  FINANCE: 2,
  FIELD_STAFF: 1,
};

/** Roles that can be handed out by invitation. OWNER is never invited — ownership is the NGOProfile. */
export const INVITABLE_ROLES: TeamRole[] = ["ADMIN", "PROGRAM_MANAGER", "FINANCE", "FIELD_STAFF"];

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  PROGRAM_MANAGER: "Program Manager",
  FINANCE: "Finance",
  FIELD_STAFF: "Field Worker",
};

/** May `actor` give someone `target`? Must manage the team, and never above their own rank. */
export function canGrantRole(actor: TeamRole, target: TeamRole): boolean {
  if (!ngoCan(actor, "manageTeam")) return false;
  if (target === "OWNER") return actor === "OWNER";
  return TEAM_ROLE_RANK[target] <= TEAM_ROLE_RANK[actor];
}

export interface NgoMembership {
  ngoId: string;
  teamRole: TeamRole;
  userId: string;
}

/**
 * The caller's membership. With `ngoId`, of THAT NGO (null when not a member);
 * without, of their own NGO: the one they own, else their oldest membership.
 */
export async function getNgoMembership(userId: string, ngoId?: string | null): Promise<NgoMembership | null> {
  if (ngoId) {
    const [owned, member] = await Promise.all([
      prisma.nGOProfile.findFirst({ where: { id: ngoId, userId }, select: { id: true } }),
      prisma.nGOTeamMember.findUnique({ where: { userId_ngoId: { userId, ngoId } }, select: { role: true } }),
    ]);
    if (owned) return { ngoId, teamRole: "OWNER", userId };
    return member ? { ngoId, teamRole: member.role, userId } : null;
  }
  const owned = await prisma.nGOProfile.findUnique({ where: { userId }, select: { id: true } });
  if (owned) return { ngoId: owned.id, teamRole: "OWNER", userId };
  const member = await prisma.nGOTeamMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { ngoId: true, role: true },
  });
  return member ? { ngoId: member.ngoId, teamRole: member.role, userId } : null;
}

export type ScopeResult = { ok: true; actor: NgoMembership } | { ok: false; response: NextResponse };

/**
 * Route guard: the session user must belong to `ngoId` (or, with null, to some
 * NGO) and — when given — hold one of `allowed` (roles or a capability).
 *
 * "Not a member" is 404 by default so an id from another tenant is
 * indistinguishable from one that does not exist; "member, but role cannot" is
 * 403 with a reason.
 */
export async function requireNgoMembership(
  session: { user?: { id?: string } | null } | null,
  ngoId: string | null,
  allowed?: TeamRole[] | NgoCapability,
  opts: { notMemberStatus?: 403 | 404 } = {}
): Promise<ScopeResult> {
  const userId = session?.user?.id;
  if (!userId) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const actor = await getNgoMembership(userId, ngoId);
  if (!actor) {
    const status = opts.notMemberStatus ?? (ngoId ? 404 : 403);
    return { ok: false, response: NextResponse.json({ error: status === 404 ? "Not found" : "No NGO membership" }, { status }) };
  }
  if (allowed) {
    const roles = typeof allowed === "string" ? NGO_CAN[allowed] : allowed;
    if (!roles.includes(actor.teamRole)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Your role on this organisation does not allow this action.", code: "TEAM_ROLE_FORBIDDEN" },
          { status: 403 }
        ),
      };
    }
  }
  return { ok: true, actor };
}

// ─── Donor-facing redaction ──────────────────────────────────────────────────

/**
 * Keys that must never reach a donor or the public in a response about an
 * organisation, a proposal or a contract: platform risk/fraud judgements,
 * internal reviewer notes, bank details and phone numbers. (An NGO's PAN is
 * NOT here: it is a legal party identifier printed on every grant contract.
 * `complianceNotes` is not here either: the CSR response flow shows a donor the
 * NGO's own compliance statement on purpose.) Beneficiary PII is kept
 * out by `DONOR_VISIBLE_EVIDENCE_WHERE` (lib/field-evidence.ts) and explicit
 * selects; this list is the belt to those braces.
 */
export const DONOR_FORBIDDEN_KEYS = [
  "riskScore",
  "riskLevel",
  "fraudScore",
  "fraudAlerts",
  "riskReviews",
  "trustInsight",
  "internalNotes",
  "adminNote",
  "adminNotes",
  "reviewerId",
  "decidedById",
  "bankAccountNumber",
  "ifscCode",
  "phone",
  "beneficiaryName",
  "beneficiaryPhone",
] as const;

/** Deep copy without DONOR_FORBIDDEN_KEYS (Dates and Decimals pass through untouched). */
export function redactForDonor<T>(value: T, extraKeys: readonly string[] = []): T {
  const banned = new Set<string>([...DONOR_FORBIDDEN_KEYS, ...extraKeys]);
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) if (!banned.has(k)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}

/** Every forbidden key found anywhere in `value` — for tests and assertions. */
export function findForbiddenKeys(value: unknown, extraKeys: readonly string[] = []): string[] {
  const banned = new Set<string>([...DONOR_FORBIDDEN_KEYS, ...extraKeys]);
  const found = new Set<string>();
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (banned.has(k)) found.add(k);
        walk(val);
      }
    }
  };
  walk(value);
  return Array.from(found);
}
