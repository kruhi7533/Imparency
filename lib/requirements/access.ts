import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkFunderEligibility } from "@/lib/matching/funder";
import { ERRORS, RequirementWorkflowError } from "./errors";
import { donorCan, resolveDonorAccount, ROLE_FORBIDDEN, type DonorCapability, type DonorRole } from "@/lib/donor-team";

/**
 * Identity + authorization for the CSR requirement workflow. Identity and role
 * always come from the server session — never from the request body/URL.
 *
 * Requirement access model:
 *   owner (the uploading sponsor)  full access to their own requirement
 *   ADMIN                          full access (governance layer)
 *   everyone else, incl. NGOs      403 — NGOs only ever see the sanitized brief
 */
export interface Actor {
  id: string;
  role: "DONOR" | "NGO" | "ADMIN";
  name: string | null;
  email: string | null;
  /**
   * The CSR account a donor acts for (lib/donor-team.ts): their own id, or the
   * owner's id when they are a team member. Requirements are owned by this id.
   * Absent for non-donors; treated as `id`.
   */
  accountId?: string;
  donorRole?: DonorRole;
}

export async function getActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  if (!user?.id || !user?.role) return null;
  const actor: Actor = { id: user.id, role: user.role, name: user.name ?? null, email: user.email ?? null };
  if (actor.role === "DONOR") {
    const account = await resolveDonorAccount(actor.id);
    actor.accountId = account.accountId;
    actor.donorRole = account.role;
  }
  return actor;
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw ERRORS.unauthenticated();
  return actor;
}

/**
 * Can this donor put a requirement in front of an NGO? (WEEK5 SPEC-1)
 *
 * Reuses lib/matching/funder.ts rather than re-deriving the rule: the funder-led
 * engine and this one must not disagree about who is allowed to fund. Its
 * messages are kept as-is — each failure (not institutional, PAN unverified,
 * organisation not verified / pending / rejected) has a different fix.
 *
 * Gated only where money and NGO attention start: creating a requirement and
 * running matching. Editing, submitting and admin validation stay open so a
 * company whose verification is PENDING can finish preparing while it waits.
 */
export async function requireVerifiedFunder(userId: string | null): Promise<void> {
  if (!userId) throw new RequirementWorkflowError("This requirement has no owning donor account.", 403);
  const check = await checkFunderEligibility(userId);
  if (!check.ok) throw new RequirementWorkflowError(check.message ?? "Your organisation is not verified yet.", 403);
}

export function isRequirementOwner(req: { sponsorId: string | null }, actor: Actor): boolean {
  return !!req.sponsorId && req.sponsorId === (actor.accountId ?? actor.id);
}

export function canViewRequirement(req: { sponsorId: string | null }, actor: Actor): boolean {
  return actor.role === "ADMIN" || isRequirementOwner(req, actor);
}

export function assertCanViewRequirement(req: { sponsorId: string | null }, actor: Actor): void {
  if (!canViewRequirement(req, actor)) throw ERRORS.forbidden();
}

export function assertAdmin(actor: Actor): void {
  if (actor.role !== "ADMIN") {
    throw ERRORS.forbidden();
  }
}

/**
 * The role an actor acts in for a given requirement: admins act as ADMIN; the
 * owner acts as DONOR (even if their session role differs); nobody else may act.
 */
/**
 * The workflow role for this actor on this requirement. For a donor it also
 * checks their team role allows `cap` — a VIEWER member can read the
 * requirement but every write path refuses them here.
 */
export function workflowRole(req: { sponsorId: string | null }, actor: Actor, cap: DonorCapability = "view"): "DONOR" | "ADMIN" {
  if (actor.role === "ADMIN") return "ADMIN";
  if (isRequirementOwner(req, actor)) {
    if (!donorCan(actor.donorRole ?? "OWNER", cap)) throw new RequirementWorkflowError(ROLE_FORBIDDEN, 403);
    return "DONOR";
  }
  throw ERRORS.forbidden();
}

/** For creating a requirement: the account it will belong to, if this donor may create one. */
export function donorAccountFor(actor: Actor, cap: DonorCapability): string {
  if (actor.role !== "DONOR") throw ERRORS.forbidden();
  if (!donorCan(actor.donorRole ?? "OWNER", cap)) throw new RequirementWorkflowError(ROLE_FORBIDDEN, 403);
  return actor.accountId ?? actor.id;
}

/** Loads a requirement (404 if missing) and checks the actor may view it (403). */
export async function loadRequirementForActor<T extends object = {}>(
  id: string,
  actor: Actor,
  include?: T
) {
  const requirement = await prisma.sponsorRequirement.findUnique({
    where: { id },
    ...(include ? { include } : {}),
  });
  if (!requirement) throw ERRORS.notFound();
  assertCanViewRequirement(requirement, actor);
  return requirement;
}

/**
 * The NGO an NGO-role user acts for: the NGO they own, else their team
 * membership. `canRespond` excludes FIELD_STAFF — proposals commit budgets.
 */
export async function resolveNgoMembership(
  userId: string
): Promise<{ ngoId: string; canRespond: boolean } | null> {
  const owned = await prisma.nGOProfile.findUnique({ where: { userId }, select: { id: true } });
  if (owned) return { ngoId: owned.id, canRespond: true };

  const membership = await prisma.nGOTeamMember.findFirst({
    where: { userId },
    select: { ngoId: true, role: true },
  });
  if (!membership) return null;
  return { ngoId: membership.ngoId, canRespond: membership.role !== "FIELD_STAFF" };
}
