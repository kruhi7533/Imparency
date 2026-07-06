import prisma from "@/lib/prisma";
import { createFraudAlert } from "@/lib/fraud-alerts";

/**
 * Checks Gemini proof validation scores.
 * Triggered on proof submission.
 *
 * Auto-suspension removed — two consecutive low scores raises a CRITICAL alert
 * and surfaces it to admin for a manual suspension decision.
 */
export async function checkGeminiScore(milestoneId: string, score: number): Promise<void> {
  try {
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { project: { include: { ngo: true } } },
    });
    if (!milestone) return;

    const ngoId = milestone.project.ngoId;

    if (score < 40) {
      await createFraudAlert(
        "EXTREMELY_LOW_PROOF_SCORE",
        milestone.id,
        "NGO",
        `Milestone "${milestone.title}" scored ${score}/100 on AI validation — evidence is insufficient or unclear.`,
        "HIGH",
        "FRAUD_ALERT"
      );

      // Check for two consecutive low scores across different milestones
      const recentProofs = await prisma.milestoneProof.findMany({
        where: {
          milestone: { project: { ngoId } },
          aiValidationScore: { not: null },
        },
        orderBy: { submittedAt: "desc" },
        take: 2,
      });

      const bothLow =
        recentProofs.length >= 2 &&
        recentProofs.every((p) => p.aiValidationScore !== null && p.aiValidationScore < 40);

      if (bothLow) {
        // Raise CRITICAL — admin must review and decide whether to suspend
        await createFraudAlert(
          "CONSECUTIVE_LOW_SCORES",
          ngoId,
          "NGO",
          `"${milestone.project.ngo.orgName}" has submitted two consecutive milestone proofs scoring below 40/100. ` +
            `Manual review required. Admin action needed: suspend or investigate.`,
          "HIGH",
          "FRAUD_ALERT"
        );

        // Surface as a RiskReview so it appears in the Risk tab with a recommended action
        const existing = await prisma.riskReview.findFirst({
          where: { ngoId, status: "OPEN" },
        });
        if (!existing) {
          await prisma.riskReview.create({
            data: {
              ngoId,
              alertIds: recentProofs.map((p) => p.id),
              riskLevel: "CRITICAL",
              findings: {
                reason: "TWO_CONSECUTIVE_LOW_PROOF_SCORES",
                scores: recentProofs.map((p) => p.aiValidationScore),
                recommendedAction: "SUSPEND_OR_INVESTIGATE",
              },
              status: "OPEN",
            },
          });
        }
      }
    }
  } catch (err) {
    console.error("[risk-agent] checkGeminiScore error:", err);
  }
}

/**
 * Checks if a donor makes more than 5 donations in under 10 minutes.
 * Triggered on donation webhook.
 */
export async function checkDonationRate(donorId: string): Promise<void> {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const count = await prisma.donation.count({
      where: { donorId, status: "SUCCESS", createdAt: { gte: tenMinutesAgo } },
    });

    if (count > 5) {
      await createFraudAlert(
        "SUSPICIOUS_DONATION_FREQUENCY",
        donorId,
        "DONOR",
        `Donor completed ${count} successful donations in under 10 minutes — potential payment testing or card fraud.`,
        "MEDIUM",
        "FRAUD_ALERT"
      );
    }
  } catch (err) {
    console.error("[risk-agent] checkDonationRate error:", err);
  }
}

/**
 * Periodic check for delayed milestones and inactive campaigns with raised funds.
 * Designed to run on page load or via cron.
 */
export async function checkGeneralPlatformAlerts(): Promise<void> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    // 1. Milestones past deadline by 30+ days with no proof
    const delayed = await prisma.milestone.findMany({
      where: {
        deadline: { lt: thirtyDaysAgo },
        status: { in: ["PENDING", "IN_PROGRESS"] },
        proofs: { none: {} },
      },
      include: { project: true },
    });

    for (const m of delayed) {
      const exists = await prisma.fraudAlert.findFirst({
        where: { type: "DEADLINE_EXCEEDED", entityId: m.id, resolved: false },
      });
      if (!exists) {
        await createFraudAlert(
          "DEADLINE_EXCEEDED",
          m.id,
          "NGO",
          `Milestone "${m.title}" deadline (${m.deadline.toLocaleDateString()}) passed 30+ days ago with no proof submitted.`,
          "MEDIUM",
          "DOCUMENT_ERROR"
        );
      }
    }

    // 2. Active projects with funds raised but zero activity for 60+ days
    const stale = await prisma.project.findMany({
      where: { raisedAmount: { gt: 0 }, status: "ACTIVE" },
      include: { ngo: true, milestones: { orderBy: { sequenceOrder: "asc" } } },
    });

    for (const p of stale) {
      const hasPendingMilestone = p.milestones.some(
        (m) => m.status === "PENDING" || m.status === "IN_PROGRESS"
      );
      if (hasPendingMilestone && p.updatedAt < sixtyDaysAgo) {
        const exists = await prisma.fraudAlert.findFirst({
          where: { type: "INACTIVE_CAMPAIGN_FUNDS", entityId: p.id, resolved: false },
        });
        if (!exists) {
          await createFraudAlert(
            "INACTIVE_CAMPAIGN_FUNDS",
            p.id,
            "NGO",
            `Campaign "${p.title}" has raised funds but zero milestone activity for 60+ days.`,
            "MEDIUM",
            "FRAUD_ALERT"
          );
        }
      }
    }
  } catch (err) {
    console.error("[risk-agent] checkGeneralPlatformAlerts error:", err);
  }
}
