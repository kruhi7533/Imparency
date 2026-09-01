import prisma from "@/lib/prisma";

/**
 * Turns a FraudAlert's entityId into the NGOProfile id it actually concerns.
 *
 * Why this is needed: FraudAlert.entityType is not a reliable description of
 * what entityId points at. Several alerts in lib/risk-agent.ts declare
 * entityType "NGO" while storing a MILESTONE id (EXTREMELY_LOW_PROOF_SCORE,
 * DEADLINE_EXCEEDED) or a PROJECT id (INACTIVE_CAMPAIGN_FUNDS) — the type
 * describes whose problem it is, not what the id is. Passing those straight
 * into an ngoId column throws a foreign-key violation.
 *
 * Rather than migrate historical alert rows (destructive, and the alert list
 * itself is fine as-is), resolve at read time: try NGO, then the two indirect
 * shapes. Returns null when the id resolves to nothing, so callers can report
 * a clean error instead of a 500.
 */
export async function resolveNgoId(entityId: string): Promise<string | null> {
  if (!entityId) return null;

  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: entityId },
    select: { id: true },
  });
  if (ngo) return ngo.id;

  const milestone = await prisma.milestone.findUnique({
    where: { id: entityId },
    select: { project: { select: { ngoId: true } } },
  });
  if (milestone) return milestone.project.ngoId;

  const project = await prisma.project.findUnique({
    where: { id: entityId },
    select: { ngoId: true },
  });
  if (project) return project.ngoId;

  return null;
}
