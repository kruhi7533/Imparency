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
 * Validates a CSR-persona donor's registration number against the real MCA
 * format (Form CSR-1 numbers are "CSR" + 8 digits, e.g. CSR00012345).
 * Triggered on donor profile save.
 *
 * This is a FORMAT check only — it catches obviously fake/placeholder entries
 * ("asdf", blank-but-required) before they sit unvalidated forever, which is
 * what happened before this existed (the field was pure free text with zero
 * validation). It cannot confirm the number is genuinely registered to this
 * company — that needs a live MCA registry lookup, which isn't integrated.
 * LOW severity: a malformed number is far more often a typo than fraud.
 */
export async function checkCsrRegistrationFormat(donorId: string): Promise<void> {
  try {
    const donor = await prisma.user.findUnique({
      where: { id: donorId },
      select: { donorPersona: true, csrRegistrationNumber: true },
    });
    if (!donor || donor.donorPersona !== "CSR_OFFICER") return;

    const raw = donor.csrRegistrationNumber?.trim() ?? "";
    if (!raw) return; // absence is a completeness gap, not a format defect — not this check's job

    if (!/^CSR\d{8}$/.test(raw)) {
      await createFraudAlert(
        "CSR_REGISTRATION_INVALID_FORMAT",
        donorId,
        "DONOR",
        `Declared CSR registration number "${raw}" does not match the MCA Form CSR-1 format (CSR + 8 digits). Likely a typo, but not yet confirmed genuine — no live registry lookup is wired up to verify it either way.`,
        "LOW",
        "DOCUMENT_ERROR",
        "FAKE_REGISTRATION"
      );
    }
  } catch (err) {
    console.error("[risk-agent] checkCsrRegistrationFormat error:", err);
  }
}

/**
 * Flags a CSR-persona donor whose cumulative donations badly outrun their own
 * declared CSR budget. Triggered on donation webhook (payment success).
 *
 * Caveat baked into the alert text on purpose: totalDonated is a LIFETIME
 * running total, csrBudget is normally an ANNUAL figure — there is no
 * fiscal-year-scoped donation aggregate in this schema to compare like-for-like.
 * A generous 2x multiplier and MEDIUM (not HIGH) severity reflect that this is
 * a "worth a look," not a confirmed anomaly.
 */
export async function checkCsrBudgetOverrun(donorId: string): Promise<void> {
  try {
    const donor = await prisma.user.findUnique({
      where: { id: donorId },
      select: { donorPersona: true, csrBudget: true, totalDonated: true },
    });
    if (!donor || donor.donorPersona !== "CSR_OFFICER" || donor.csrBudget == null) return;

    const budget = Number(donor.csrBudget);
    const total = Number(donor.totalDonated);
    if (budget <= 0 || total <= budget * 2) return;

    const exists = await prisma.fraudAlert.findFirst({
      where: { type: "CSR_BUDGET_EXCEEDED", entityId: donorId, resolved: false },
    });
    if (exists) return; // don't re-alert every donation once already flagged and open

    await createFraudAlert(
      "CSR_BUDGET_EXCEEDED",
      donorId,
      "DONOR",
      `Donor's lifetime donations (₹${total.toLocaleString("en-IN")}) are more than double their declared CSR budget (₹${budget.toLocaleString("en-IN")}). Note: this compares a lifetime total against what is normally an annual figure — verify the declared budget is current before treating this as unusual.`,
      "MEDIUM",
      "FRAUD_ALERT"
    );
  } catch (err) {
    console.error("[risk-agent] checkCsrBudgetOverrun error:", err);
  }
}

/**
 * Structuring check: the same donor sending the same NGO several separate
 * donations that together cross a reporting-style threshold, rather than one
 * lump sum — the classic pattern for staying under scrutiny. Triggered on
 * donation webhook (payment success).
 *
 * ₹2,00,000 mirrors the Income Tax Act §269ST cash-transaction reporting
 * threshold; donations here are digital, not cash, but the "avoid crossing a
 * round reporting number in one visible transaction" logic is the same shape.
 * Requires 3+ separate transactions, not just a high total — one legitimate
 * large donation must never trip this.
 */
export async function checkDonationStructuring(donorId: string, ngoId: string): Promise<void> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const donations = await prisma.donation.findMany({
      where: {
        donorId,
        status: "SUCCESS",
        createdAt: { gte: thirtyDaysAgo },
        project: { ngoId },
      },
      select: { amount: true },
    });

    if (donations.length < 3) return;
    const total = donations.reduce((sum, d) => sum + Number(d.amount), 0);
    if (total < 200_000) return;

    const exists = await prisma.fraudAlert.findFirst({
      where: { type: "DONATION_STRUCTURING_PATTERN", entityId: donorId, resolved: false },
    });
    if (exists) return;

    await createFraudAlert(
      "DONATION_STRUCTURING_PATTERN",
      donorId,
      "DONOR",
      `Donor sent ${donations.length} separate donations totalling ₹${total.toLocaleString("en-IN")} to the same NGO within 30 days — a pattern of many smaller transactions rather than one lump sum, worth checking against a genuine recurring-donor explanation.`,
      "MEDIUM",
      "FRAUD_ALERT"
    );
  } catch (err) {
    console.error("[risk-agent] checkDonationStructuring error:", err);
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

    // Every "has this already been alerted?" answer this sweep needs, in one
    // query. It used to be one findFirst per candidate — and this function runs
    // on the Risk & Compliance page load, so those were round trips a human
    // waited through, growing with the size of the backlog. The page got slower
    // exactly as the queue got worse.
    //
    // The alert writes below stay sequential on purpose: createFraudAlert awaits
    // maybeInvestigate, which can start a full AI investigation, and firing
    // those concurrently is not something this sweep should decide to do.
    const openAlerts = await prisma.fraudAlert.findMany({
      where: {
        type: { in: ["DEADLINE_EXCEEDED", "INACTIVE_CAMPAIGN_FUNDS"] },
        resolved: false,
      },
      select: { type: true, entityId: true },
    });
    const alreadyAlerted = new Set(openAlerts.map((a) => `${a.type}:${a.entityId}`));

    for (const m of delayed) {
      if (!alreadyAlerted.has(`DEADLINE_EXCEEDED:${m.id}`)) {
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
      if (
        hasPendingMilestone &&
        p.updatedAt < sixtyDaysAgo &&
        !alreadyAlerted.has(`INACTIVE_CAMPAIGN_FUNDS:${p.id}`)
      ) {
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
  } catch (err) {
    console.error("[risk-agent] checkGeneralPlatformAlerts error:", err);
  }
}
