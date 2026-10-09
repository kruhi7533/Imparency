import prisma from "@/lib/prisma";
import { classifyDuplicate, evidenceSlot, type DuplicateResult, type PriorProofMatch } from "@/lib/proof-fingerprint";

/** A candidate row plus the hashes it carries, so callers can tell which
 *  submission a candidate actually collides with. */
export interface EvidenceCandidate {
  match: PriorProofMatch;
  hashes: string[];
}

/**
 * Earlier evidence sharing a file with a new submission, from BOTH evidence
 * tables. The verdict itself is lib/proof-fingerprint.ts's classifyDuplicate;
 * this module only gathers the candidates, so both submission routes ask the
 * same question of the same data.
 *
 * Callers must run this BEFORE writing the new row, so a submission can never
 * match itself, and must treat a throw as "check unavailable" rather than
 * blocking the submission (same contract as the GPS read).
 */
export async function findPriorEvidence(hashes: string[]): Promise<PriorProofMatch[]> {
  return (await findEvidenceCandidates(hashes)).map((c) => c.match);
}

/** Every evidence row, in either table, carrying any of `hashes`. */
export async function findEvidenceCandidates(hashes: string[]): Promise<EvidenceCandidate[]> {
  const unique = Array.from(new Set(hashes.filter(Boolean)));
  if (unique.length === 0) return [];

  const [proofs, captures] = await Promise.all([
    prisma.milestoneProof.findMany({
      where: { contentHashes: { hasSome: unique } },
      select: {
        id: true,
        milestoneId: true,
        contentHashes: true,
        milestone: {
          select: {
            title: true,
            projectId: true,
            project: { select: { ngoId: true, ngo: { select: { orgName: true } } } },
          },
        },
      },
    }),
    prisma.fieldEvidence.findMany({
      where: { photoSha256: { in: unique } },
      select: {
        id: true,
        ngoId: true,
        projectId: true,
        milestoneId: true,
        taskId: true,
        photoSha256: true,
        task: { select: { title: true, milestone: { select: { title: true } } } },
      },
    }),
  ]);

  return [
    ...proofs.map(
      (c): EvidenceCandidate => ({
        hashes: c.contentHashes,
        match: {
          proofId: c.id,
          source: "MILESTONE_PROOF",
          milestoneId: c.milestoneId,
          milestoneTitle: c.milestone.title,
          projectId: c.milestone.projectId,
          ngoId: c.milestone.project.ngoId,
          orgName: c.milestone.project.ngo.orgName,
        },
      }),
    ),
    ...captures.map(
      (c): EvidenceCandidate => ({
        hashes: [c.photoSha256],
        match: {
          proofId: c.id,
          source: "FIELD_EVIDENCE",
          milestoneId: evidenceSlot(c.milestoneId, c.taskId),
          milestoneTitle: c.task.milestone?.title ?? c.task.title,
          projectId: c.projectId,
          ngoId: c.ngoId,
          // FieldEvidence has no NGO relation; the alert still names the row id.
          orgName: null,
        },
      }),
    ),
  ];
}

/** A milestone proof as the review queue holds it. */
export interface QueuedProof {
  id: string;
  milestoneId: string;
  projectId: string;
  ngoId: string;
  contentHashes: string[];
}

/**
 * Duplicate verdict per queued proof, for the admin review queue (SPEC-2.3).
 *
 * Pure: given the queue and every candidate sharing any of its hashes, each
 * proof is classified against the candidates it actually shares a file with —
 * never against itself. A proof with no hashes (submitted before
 * fingerprinting, not yet backfilled) gets no entry: "not checked" must never
 * render as "no duplicates".
 */
export function verdictsForQueuedProofs(
  proofs: QueuedProof[],
  candidates: EvidenceCandidate[],
): Record<string, DuplicateResult> {
  const out: Record<string, DuplicateResult> = {};
  for (const proof of proofs) {
    if (proof.contentHashes.length === 0) continue;
    const mine = new Set(proof.contentHashes);
    const matches = candidates
      .filter((c) => !(c.match.source !== "FIELD_EVIDENCE" && c.match.proofId === proof.id))
      .filter((c) => c.hashes.some((h) => mine.has(h)))
      .map((c) => c.match);
    out[proof.id] = classifyDuplicate(matches, {
      milestoneId: proof.milestoneId,
      projectId: proof.projectId,
      ngoId: proof.ngoId,
    });
  }
  return out;
}
