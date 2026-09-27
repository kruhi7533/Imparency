import prisma from "@/lib/prisma";
import { deriveFcraStatus } from "@/lib/ngo-compliance";
import { commitRequirementChange } from "@/lib/requirements/commit";
import { recordRequirementEvent } from "@/lib/requirements/audit";
import { ERRORS, RequirementWorkflowError } from "@/lib/requirements/errors";
import { normalizeFields } from "@/lib/requirements/provenance";
import { loadRequirementForActor, workflowRole, type Actor } from "@/lib/requirements/access";
import {
  ALGORITHM_VERSION,
  rankCandidates,
  toMatchRequirement,
  type CandidateProject,
} from "../matchingEngine";

/**
 * Gap Diagnoser + Matching run for one ADMIN-VALIDATED requirement.
 *
 * Compares the requirement against every live candidate project (active,
 * not deleted, NGO verified and not suspended), persists one GapReport with a
 * RequirementMatch per candidate, and moves the requirement to SHORTLISTED
 * (or back to VALIDATED if nobody is eligible). It ranks; it never selects.
 */

const LIVE_FCRA = new Set(["ACTIVE", "EXPIRING_SOON", "EXPIRED"]);

function monthsBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
}

/** Loads candidate projects with the data the engine needs (see CandidateProject). */
export async function loadCandidates(): Promise<CandidateProject[]> {
  const projects = await prisma.project.findMany({
    where: {
      status: "ACTIVE",
      isDeleted: false,
      ngo: { verificationStatus: "VERIFIED", isSuspended: false, isDeleted: false },
    },
    include: {
      ngo: { include: { compliance: true } },
      milestones: { select: { title: true, description: true, deadline: true } },
    },
  });

  return projects.map((p) => {
    const deadlines = p.milestones.map((m) => m.deadline.getTime());
    const compliance = p.ngo.compliance;
    // Same live-status rule as the donation FCRA gate: never trust a stale stored status.
    const storedFcra = compliance?.fcraStatus ?? "NONE";
    const fcraStatus = LIVE_FCRA.has(storedFcra) ? deriveFcraStatus(compliance?.fcraExpiryDate) ?? storedFcra : storedFcra;

    const outcomeText = [
      p.expected_outcome,
      p.problem_statement,
      ...p.milestones.flatMap((m) => [m.title, m.description]),
    ]
      .filter(Boolean)
      .join(". ");

    return {
      projectId: p.id,
      ngoId: p.ngoId,
      ngoName: p.ngo.orgName,
      projectTitle: p.title,
      causeCategory: p.causeCategory || null,
      ngoCauseCategories: p.ngo.causeCategories ?? [],
      stateName: p.stateName,
      districtName: p.districtName,
      location: p.location || null,
      targetAmount: Number(p.targetAmount) || null,
      durationMonths: deadlines.length ? monthsBetween(p.createdAt, new Date(Math.max(...deadlines))) : null,
      outcomeText: outcomeText || null,
      healthScore: p.ngo.healthScore === null ? null : Number(p.ngo.healthScore),
      fcraStatus,
      eightyGVerified: !!compliance?.eightyGVerified,
      twelveAVerified: !!compliance?.a12Verified,
    };
  });
}

/**
 * Starts matching. Allowed only for the owner or an admin, and only when the
 * requirement is VALIDATED — or SHORTLISTED with nobody invited yet (a rematch).
 */
export async function runMatching(requirementId: string, actor: Actor) {
  const req = await loadRequirementForActor(requirementId, actor);
  const role = workflowRole(req, actor);

  if (req.status === "SHORTLISTED") {
    const invited = await prisma.requirementMatch.count({ where: { requirementId, invitedAt: { not: null } } });
    if (invited > 0) {
      throw new RequirementWorkflowError("NGOs have already been invited from this shortlist, so it can no longer be re-run.", 400);
    }
  } else if (req.status !== "VALIDATED") {
    throw ERRORS.matchingNotAllowed();
  }
  const previousStatus = req.status;

  const matching = await prisma.$transaction((tx) =>
    commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: role,
      toStatus: "MATCHING",
      audit: { action: "REQUIREMENT_MATCHING_STARTED", detail: "Gap analysis and matching started." },
    })
  );

  try {
    const matchReq = toMatchRequirement(normalizeFields(matching.extractedFields));
    const candidates = await loadCandidates();
    const { eligible, excluded } = rankCandidates(matchReq, candidates);
    const topScore = eligible[0]?.score ?? 0;

    const gapCounts: Record<string, number> = {};
    for (const e of eligible) for (const g of e.gaps) gapCounts[g.dimension] = (gapCounts[g.dimension] ?? 0) + 1;
    const commonGaps = Object.entries(gapCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dimension, count]) => ({ dimension, candidatesAffected: count }));

    return await prisma.$transaction(async (tx) => {
      const report = await tx.gapReport.create({
        data: {
          sponsorRequirementId: requirementId,
          overallCompatibility: topScore,
          algorithmVersion: ALGORITHM_VERSION,
          candidateCount: candidates.length,
          eligibleCount: eligible.length,
          triggeredById: actor.id,
          gapReport: { requirement: matchReq, excludedCount: excluded.length, commonGaps } as any,
          recommendations: commonGaps as any,
        },
      });

      const rows = [...eligible, ...excluded.map((e) => ({ ...e, rank: null as number | null }))];
      if (rows.length > 0) {
        await tx.requirementMatch.createMany({
          data: rows.map((e) => ({
            requirementId,
            gapReportId: report.id,
            projectId: e.projectId,
            ngoId: e.ngoId,
            eligible: e.eligible,
            rank: e.rank,
            score: e.score,
            coverage: e.coverage,
            hardEligibility: e.hardEligibility as any,
            dimensionScores: e.dimensions as any,
            gaps: e.gaps as any,
            explanation: e.explanation,
          })),
        });
      }

      await recordRequirementEvent(tx, {
        requirementId,
        action: "GAP_ANALYSIS_COMPLETED",
        actorId: null,
        actorRole: "SYSTEM",
        fromStatus: "MATCHING",
        toStatus: "MATCHING",
        detail: `${candidates.length} candidate projects evaluated; ${eligible.length} eligible, ${excluded.length} excluded by hard rules.`,
        metadata: { gapReportId: report.id, algorithmVersion: ALGORITHM_VERSION },
      });

      const final = await commitRequirementChange(tx, matching, {
        actorId: null,
        actorRole: "SYSTEM",
        toStatus: eligible.length > 0 ? "SHORTLISTED" : "VALIDATED",
        audit: {
          action: eligible.length > 0 ? "SHORTLIST_CREATED" : "GAP_ANALYSIS_COMPLETED",
          detail:
            eligible.length > 0
              ? `Ranked shortlist of ${eligible.length} created (top score ${topScore}).`
              : "No eligible candidates found; requirement returned to validated.",
          metadata: { gapReportId: report.id },
        },
      });

      return { gapReportId: report.id, status: final.status, candidateCount: candidates.length, eligibleCount: eligible.length };
    });
  } catch (err) {
    // Put the requirement back where it was so matching can be retried.
    try {
      const stuck = await prisma.sponsorRequirement.findUnique({ where: { id: requirementId } });
      if (stuck?.status === "MATCHING") {
        await prisma.$transaction((tx) =>
          commitRequirementChange(tx, stuck, {
            actorId: null,
            actorRole: "SYSTEM",
            toStatus: previousStatus,
            audit: { action: "MATCHING_FAILED", detail: String((err as any)?.message ?? err).slice(0, 500) },
          })
        );
      }
    } catch (revertErr) {
      console.error("[matching] failed to revert MATCHING status:", revertErr);
    }
    throw err;
  }
}

/** Latest matching run (with matches) for a requirement the actor may view. */
export async function getLatestMatchRun(requirementId: string, actor: Actor) {
  await loadRequirementForActor(requirementId, actor);
  return prisma.gapReport.findFirst({
    where: { sponsorRequirementId: requirementId },
    orderBy: { createdAt: "desc" },
    include: {
      matches: {
        orderBy: [{ eligible: "desc" }, { rank: "asc" }],
        include: {
          project: { select: { title: true } },
          ngo: { select: { orgName: true } },
        },
      },
    },
  });
}
