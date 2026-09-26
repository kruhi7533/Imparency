import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ERRORS } from "./errors";

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
}

export async function getActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  if (!user?.id || !user?.role) return null;
  return { id: user.id, role: user.role, name: user.name ?? null, email: user.email ?? null };
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw ERRORS.unauthenticated();
  return actor;
}

export function isRequirementOwner(req: { sponsorId: string | null }, actor: Actor): boolean {
  return !!req.sponsorId && req.sponsorId === actor.id;
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
export function workflowRole(req: { sponsorId: string | null }, actor: Actor): "DONOR" | "ADMIN" {
  if (actor.role === "ADMIN") return "ADMIN";
  if (isRequirementOwner(req, actor)) return "DONOR";
  throw ERRORS.forbidden();
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
