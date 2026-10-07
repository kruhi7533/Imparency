import prisma from "@/lib/prisma";
import { sendPushNotification } from "@/lib/notification";

/**
 * Week 7: milestone updates for CSR contract donors.
 *
 * The existing milestone notifications (lib/notification-triggers.ts) reach
 * donors through DONATIONS. A CSR donor funds through a Contract and has no
 * donation row, so they never heard about the work they paid for. This sends
 * them the same kind of in-app + push update.
 *
 * Callers fire this only after the state change has committed (a
 * compare-and-swap decision), so it runs once per real event. It never throws:
 * a failed notification must not undo or fail the review that caused it.
 */

/** Donors with an ACTIVE or COMPLETED contract on the project, de-duplicated. */
export async function contractDonorIds(projectId: string): Promise<string[]> {
  const contracts = await prisma.contract.findMany({
    where: { projectId, status: { in: ["ACTIVE", "COMPLETED"] } },
    select: { donorId: true },
  });
  return Array.from(new Set(contracts.map((c) => c.donorId)));
}

export async function notifyContractDonors(
  projectId: string,
  title: string,
  body: string,
): Promise<{ notified: number; failed: number }> {
  try {
    const donorIds = await contractDonorIds(projectId);
    const results = await Promise.allSettled(
      donorIds.map((id) => sendPushNotification(id, title, body, { projectId, link: `/donor/funded/${projectId}` })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) console.error(`[contract-donor-updates] ${failed}/${donorIds.length} notifications failed for project ${projectId}`);
    return { notified: donorIds.length - failed, failed };
  } catch (err) {
    console.error(`[contract-donor-updates] could not notify donors for project ${projectId}:`, err);
    return { notified: 0, failed: 0 };
  }
}

/** A project milestone was verified complete. */
export async function notifyContractDonorsMilestoneCompleted(milestoneId: string) {
  let milestone: { title: string; projectId: string; project: { title: string } } | null = null;
  try {
    milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { title: true, projectId: true, project: { select: { title: true } } },
    });
  } catch (err) {
    console.error(`[contract-donor-updates] could not load milestone ${milestoneId}:`, err);
  }
  if (!milestone) return { notified: 0, failed: 0 };
  return notifyContractDonors(
    milestone.projectId,
    "Milestone completed",
    `"${milestone.title}" on "${milestone.project.title}" has been verified as complete.`,
  );
}

/** New field evidence was approved and is visible to donors. */
export async function notifyContractDonorsEvidenceApproved(evidence: { projectId: string; milestoneTitle: string | null; projectTitle: string }) {
  return notifyContractDonors(
    evidence.projectId,
    "New verified field update",
    `A verified photo update${evidence.milestoneTitle ? ` for "${evidence.milestoneTitle}"` : ""} was added to "${evidence.projectTitle}".`,
  );
}
