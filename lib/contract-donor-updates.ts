import prisma from "@/lib/prisma";
import { dispatchDonorNotification } from "@/lib/notification-dispatch";

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

/**
 * The funding donors who still want these updates. A donor who switched off
 * project updates (User.projectUpdatesOptOut) is skipped entirely — no in-app
 * row and no push. Their funded-project page still shows everything; opting
 * out silences messages, never visibility.
 */
export async function notifiableDonorIds(projectId: string): Promise<string[]> {
  const contracts = await prisma.contract.findMany({
    where: { projectId, status: { in: ["ACTIVE", "COMPLETED"] }, donor: { projectUpdatesOptOut: false } },
    select: { donorId: true },
  });
  return Array.from(new Set(contracts.map((c) => c.donorId)));
}

/**
 * DON-018: every funding donor goes through lib/notification-dispatch.ts —
 * including one who switched project updates off, whose attempts are logged as
 * OPTED_OUT rather than silently skipped. `notified` counts donors reached on
 * at least one channel; `failed` counts donors no channel reached because a
 * send FAILED. `eventKey` makes a re-fired event a no-op per donor/channel.
 */
export async function notifyContractDonors(
  projectId: string,
  title: string,
  body: string,
  eventKey: string = `project-update:${projectId}:${title}:${Date.now()}`,
): Promise<{ notified: number; failed: number }> {
  try {
    const donorIds = await contractDonorIds(projectId);
    let project: { title: string } | null = null;
    try {
      project = await prisma.project.findUnique({ where: { id: projectId }, select: { title: true } });
    } catch {
      project = null; // the title only decorates the email
    }
    let notified = 0;
    let failed = 0;
    for (const id of donorIds) {
      const results = await dispatchDonorNotification({
        userId: id,
        eventKey,
        topic: "PROJECT_UPDATE",
        title,
        body,
        link: `/donor/funded/${projectId}`,
        data: { projectId },
        projectTitle: project?.title,
      });
      if (results.some((r) => r.status === "SENT")) notified++;
      else if (results.some((r) => r.status === "FAILED")) failed++;
    }
    if (failed > 0) console.error(`[contract-donor-updates] ${failed}/${donorIds.length} donors could not be reached for project ${projectId}`);
    return { notified, failed };
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
    `contract-milestone-completed:${milestoneId}`,
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
