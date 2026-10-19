import prisma from "@/lib/prisma";

/**
 * Approved field evidence counted toward a milestone proof.
 *
 * Field evidence already passed a human review (/admin/field-evidence), so an
 * NGO should not have to re-upload the same photo as milestone proof — doing so
 * would also trip the duplicate-media check against its own field capture. The
 * proof REFERENCES the evidence by id instead (`MilestoneProof.fieldEvidenceIds`):
 *
 * - The photo is never copied into `mediaUrls`. Those are shown on the public
 *   project page; field photos are private and gated by beneficiary consent
 *   (`isShareableWithDonor`). They stay behind GET /api/field/evidence/[id]/photo.
 * - Their hashes are not added to `contentHashes`, so an explicit attachment is
 *   not reported as reuse of the NGO's own evidence.
 * - Attaching does not approve the milestone. Admin proof review still decides.
 */

export const MAX_ATTACHED_EVIDENCE = 10;

export interface AttachableEvidence {
  id: string;
  ngoId: string;
  projectId: string;
  milestoneId: string | null;
  status: string;
}

/**
 * Which of the requested ids may be attached to a proof for this milestone.
 * Each must be this NGO's, on this project, APPROVED, and either not tied to a
 * milestone or tied to this one. Anything else is refused by id — never
 * silently dropped, so the NGO is not left believing evidence was attached.
 */
export function checkAttachableEvidence(
  requestedIds: string[],
  rows: AttachableEvidence[],
  target: { ngoId: string; projectId: string; milestoneId: string }
): { ok: true; ids: string[] } | { ok: false; status: number; error: string } {
  const ids = Array.from(new Set(requestedIds.filter((id) => typeof id === "string" && id.length > 0)));
  if (ids.length > MAX_ATTACHED_EVIDENCE) {
    return { ok: false, status: 400, error: `Attach at most ${MAX_ATTACHED_EVIDENCE} field evidence items.` };
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    // Another NGO's evidence reads the same as missing evidence.
    if (!r || r.ngoId !== target.ngoId) return { ok: false, status: 400, error: "Some of the selected field evidence was not found." };
    if (r.projectId !== target.projectId) return { ok: false, status: 400, error: "Field evidence from another project can't be attached." };
    if (r.milestoneId && r.milestoneId !== target.milestoneId) {
      return { ok: false, status: 400, error: "Field evidence captured for a different milestone can't be attached." };
    }
    if (r.status !== "APPROVED") return { ok: false, status: 400, error: "Only field evidence a reviewer has approved can be attached." };
  }
  return { ok: true, ids };
}

/** Approved evidence the NGO could attach to a proof for this milestone. */
export async function listAttachableEvidence(ngoId: string, projectId: string, milestoneId: string) {
  return prisma.fieldEvidence.findMany({
    where: {
      ngoId,
      projectId,
      status: "APPROVED",
      OR: [{ milestoneId: null }, { milestoneId }],
    },
    orderBy: { capturedAt: "desc" },
    take: 50,
    select: { id: true, note: true, capturedAt: true, containsPeople: true, task: { select: { title: true } } },
  });
}

export async function loadEvidenceForCheck(ids: string[]): Promise<AttachableEvidence[]> {
  if (ids.length === 0) return [];
  return prisma.fieldEvidence.findMany({
    where: { id: { in: ids } },
    select: { id: true, ngoId: true, projectId: true, milestoneId: true, status: true },
  });
}
