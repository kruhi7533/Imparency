import prisma from "@/lib/prisma";

export type AlertCategory = "DOCUMENT_ERROR" | "FRAUD_ALERT";
export type AlertSubType =
  | "MISSING_DOCUMENT"
  | "WRONG_DOCUMENT_TYPE"
  | "EXPIRED_DOCUMENT"
  | "UNREADABLE_DOCUMENT"
  | "NAME_MISMATCH"
  | "DUPLICATE_IDENTITY"
  | "PAN_API_MISMATCH"
  | "FAKE_REGISTRATION"
  | "TAMPERED_DOCUMENT";

export async function createFraudAlert(
  type: string,
  entityId: string,
  entityType: string,
  description: string,
  severity: "LOW" | "MEDIUM" | "HIGH",
  alertCategory: AlertCategory = "FRAUD_ALERT",
  subType?: AlertSubType
): Promise<void> {
  try {
    await prisma.fraudAlert.create({
      data: {
        type,
        entityId,
        entityType,
        description,
        severity,
        alertCategory,
        subType,
        resolved: false
      }
    });
    console.log(`[${alertCategory} - ${severity}]: ${type} on ${entityType} ${entityId} - ${description}`);
  } catch (error) {
    console.error("Failed to create fraud alert:", error);
  }
}

/**
 * Checks if the same PAN number is used by multiple users.
 * Triggered during registration / updates.
 */
export async function checkPANUsage(panNumber: string, userId: string): Promise<void> {
  if (!panNumber) return;

  try {
    const duplicateUsers = await prisma.user.findMany({
      where: {
        panNumber,
        id: { not: userId }
      }
    });

    if (duplicateUsers.length > 0) {
      await createFraudAlert(
        "DUPLICATE_PAN_REGISTRATION",
        userId,
        "DONOR",
        `User registration PAN number ${panNumber} matches existing user(s): ${duplicateUsers.map(u => u.id).join(", ")}`,
        "HIGH",
        "FRAUD_ALERT",
        "DUPLICATE_IDENTITY"
      );
    }
  } catch (error) {
    console.error("Error checking PAN usage:", error);
  }
}

/**
 * Checks Gemini proof validation scores.
 * Triggered on submit-proof.
 */
export async function checkGeminiScore(milestoneId: string, score: number): Promise<void> {
  try {
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        project: {
          include: {
            ngo: true
          }
        }
      }
    });

    if (!milestone) return;
    const ngoId = milestone.project.ngoId;

    // 1. Trigger HIGH alert if score is below 40
    if (score < 40) {
      await createFraudAlert(
        "EXTREMELY_LOW_PROOF_SCORE",
        milestone.id,
        "NGO",
        `NGO submitted proof for milestone "${milestone.title}" that scored an extremely low AI score of ${score}/100.`,
        "HIGH",
        "FRAUD_ALERT"
      );

      // 2. Check if NGO has received two consecutive scores below 40 on different milestones
      const recentProofs = await prisma.milestoneProof.findMany({
        where: {
          milestone: {
            project: { ngoId }
          },
          aiValidationScore: { not: null }
        },
        orderBy: { submittedAt: "desc" },
        take: 2
      });

      if (
        recentProofs.length >= 2 &&
        recentProofs.every(p => p.aiValidationScore !== null && p.aiValidationScore < 40)
      ) {
        // Suspend the NGO profile
        await prisma.nGOProfile.update({
          where: { id: ngoId },
          data: { isSuspended: true }
        });

        await createFraudAlert(
          "CONSECUTIVE_LOW_SCORES_SUSPENSION",
          ngoId,
          "NGO",
          `NGO "${milestone.project.ngo.orgName}" has been auto-suspended due to receiving consecutive low Gemini proof validation scores (< 40).`,
          "HIGH",
          "FRAUD_ALERT"
        );
      }
    }
  } catch (error) {
    console.error("Error checking Gemini score alerts:", error);
  }
}

/**
 * Checks if a donor makes more than 5 donations in under 10 minutes.
 * Triggered on donationwebhook.
 */
export async function checkDonationRate(donorId: string): Promise<void> {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentDonationsCount = await prisma.donation.count({
      where: {
        donorId,
        status: "SUCCESS",
        createdAt: { gte: tenMinutesAgo }
      }
    });

    if (recentDonationsCount > 5) {
      await createFraudAlert(
        "SUSPICIOUS_DONATION_FREQUENCY",
        donorId,
        "DONOR",
        `Donor has completed ${recentDonationsCount} successful donations in the last 10 minutes (potential payment testing fraud).`,
        "MEDIUM",
        "FRAUD_ALERT"
      );
    }
  } catch (error) {
    console.error("Error checking donation rate alerts:", error);
  }
}

/**
 * Checks for delayed milestones and inactive campaigns.
 * Designed to be run periodically or manually from admin checks.
 */
export async function checkGeneralPlatformAlerts(): Promise<void> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    // 1. Milestone deadline exceeded by more than 30 days with no proof submitted
    const delayedMilestones = await prisma.milestone.findMany({
      where: {
        deadline: { lt: thirtyDaysAgo },
        status: { in: ["PENDING", "IN_PROGRESS"] },
        proofs: { none: {} }
      },
      include: { project: true }
    });

    for (const m of delayedMilestones) {
      const existingAlert = await prisma.fraudAlert.findFirst({
        where: {
          type: "DEADLINE_EXCEEDED",
          entityId: m.id,
          resolved: false
        }
      });

      if (!existingAlert) {
        await createFraudAlert(
          "DEADLINE_EXCEEDED",
          m.id,
          "NGO",
          `Milestone "${m.title}" deadline (${m.deadline.toLocaleDateString()}) exceeded by more than 30 days with no proof submitted.`,
          "MEDIUM",
          "DOCUMENT_ERROR"
        );
      }
    }

    // 2. NGO has raised funds but has zero milestone activity for 60+ days
    const activeProjects = await prisma.project.findMany({
      where: {
        raisedAmount: { gt: 0 },
        status: "ACTIVE"
      },
      include: {
        ngo: true,
        milestones: {
          orderBy: { sequenceOrder: "asc" }
        }
      }
    });

    for (const p of activeProjects) {
      const firstPendingMilestone = p.milestones.find(m => m.status === "PENDING" || m.status === "IN_PROGRESS");
      if (firstPendingMilestone) {
        const lastUpdate = p.updatedAt;
        if (lastUpdate < sixtyDaysAgo) {
          const existingAlert = await prisma.fraudAlert.findFirst({
            where: {
              type: "INACTIVE_CAMPAIGN_FUNDS",
              entityId: p.id,
              resolved: false
            }
          });

          if (!existingAlert) {
            await createFraudAlert(
              "INACTIVE_CAMPAIGN_FUNDS",
              p.id,
              "NGO",
              `Campaign "${p.title}" has raised funds but has seen zero milestone activity or updates for over 60 days.`,
              "MEDIUM",
              "FRAUD_ALERT"
            );
          }
        }
      }
    }
  } catch (error) {
    console.error("Error executing platform fraud checks:", error);
  }
}
