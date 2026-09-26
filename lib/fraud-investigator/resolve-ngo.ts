import prisma from "@/lib/prisma";

/**
 * Turns a FraudAlert's entityId into the NGOProfile id it actually concerns.
 *
 * Why this is needed: an alert's entityId is not always an NGO id.
 * EXTREMELY_LOW_PROOF_SCORE and DEADLINE_EXCEEDED point at a MILESTONE,
 * INACTIVE_CAMPAIGN_FUNDS at a PROJECT — correctly, since that is what each
 * alert is about. They still concern the organisation behind that record, and
 * passing the id straight into an ngoId column throws a foreign-key violation.
 *
 * Those three used to declare entityType "NGO" while storing the indirect id,
 * which is now fixed at the source in lib/risk-agent.ts. This still resolves by
 * trying all three shapes rather than trusting entityType, because HISTORICAL
 * rows written before that fix keep the old mislabelled type, and migrating
 * them would rewrite audit records to tidy a column.
 *
 * Returns null when the id resolves to nothing, so callers can report a clean
 * error instead of a 500.
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
