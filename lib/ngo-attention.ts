import prisma from "@/lib/prisma";

export type NgoAttentionCounts = {
  invitationsOpen: number;
  paymentsToConfirm: number;
  evidenceReturned: number;
  reportsReturned: number;
  funderRequests: number;
};

/**
 * Live counts of work waiting on one NGO organisation. Shared by the
 * dashboard's "Needs your attention" panel and the portal sidebar badges so
 * the two can never disagree.
 */
export async function getNgoAttentionCounts(ngoId: string): Promise<NgoAttentionCounts> {
  const [invitations, responded, paymentsToConfirm, evidenceReturned, funderRequests, reportsReturned] = await Promise.all([
    prisma.requirementMatch.findMany({ where: { ngoId, invitedAt: { not: null } }, select: { requirementId: true } }),
    prisma.opportunityResponse.findMany({ where: { ngoId }, select: { requirementId: true } }),
    prisma.contractPayment.count({ where: { status: "PENDING_CONFIRMATION", contract: { ngoId } } }),
    prisma.fieldEvidence.count({ where: { ngoId, status: "RESUBMIT_REQUESTED" } }),
    prisma.renewalRequest.count({ where: { ngoId, status: "OPEN" } }),
    prisma.contractImpactReport.count({ where: { ngoId, status: "RETURNED" } }),
  ]);
  const answered = new Set(responded.map((r) => r.requirementId));
  const invitationsOpen = new Set(invitations.map((m) => m.requirementId).filter((id) => !answered.has(id))).size;
  return { invitationsOpen, paymentsToConfirm, evidenceReturned, reportsReturned, funderRequests };
}
