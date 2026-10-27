import type { FieldEvidenceStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isShareableWithDonor, resolveNgoActor } from "@/lib/field-evidence";
import { resolveDonorAccount } from "@/lib/donor-team";

/**
 * Who may see one field photo. The single rule behind the photo route, the
 * signed-link issuer and every list that hands out links:
 *  - the NGO's own team: always (they need to see what was rejected and why);
 *  - an admin: always (it is the review queue);
 *  - a donor: only if they fund this project through an ACTIVE/COMPLETED
 *    contract AND the evidence is approved and consented (isShareableWithDonor).
 *    Rejection or consent withdrawal therefore revokes donor access at once,
 *    including links issued before it.
 */
export interface EvidenceForAccess {
  ngoId: string;
  projectId: string;
  status: FieldEvidenceStatus;
  containsPeople: boolean;
  feedback: { consentToSharePhoto: boolean; withdrawnAt: Date | null } | null;
}

export async function canViewEvidencePhoto(user: { id: string; role: string }, evidence: EvidenceForAccess): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (user.role === "NGO") return (await resolveNgoActor(user.id))?.ngoId === evidence.ngoId;
  if (user.role === "DONOR") {
    // Cheap rule first: no query when the evidence is not shareable at all.
    if (!isShareableWithDonor(evidence, evidence.feedback)) return false;
    const funds = await prisma.contract.findFirst({
      where: {
        donorId: (await resolveDonorAccount(user.id)).accountId,
        projectId: evidence.projectId,
        status: { in: ["ACTIVE", "COMPLETED"] },
      },
      select: { id: true },
    });
    return !!funds;
  }
  return false;
}

export const EVIDENCE_ACCESS_SELECT = {
  ngoId: true,
  projectId: true,
  status: true,
  containsPeople: true,
  feedback: { select: { consentToSharePhoto: true, withdrawnAt: true } },
} as const;
