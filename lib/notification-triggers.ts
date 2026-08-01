import prisma from "@/lib/prisma";
import { generateImpactNarrative } from "@/lib/gemini/generate-narrative";
import { sendPushNotification } from "@/lib/notification";
import {
  sendMilestoneCompletedEmail,
  sendProofApprovedEmail,
  sendProofRejectedEmail,
  sendNewProjectAlertEmail
} from "@/lib/email";
import { captureError } from "@/lib/observability";

// Gemini's free-tier quota is 5 requests/minute per model — reproduced live,
// firing all donors' narrative calls at once blows through that on the very
// first batch (donors 2-8 of an 8-donor milestone all got 429s simultaneously).
// A paid tier raises the ceiling but every tier still has a per-minute cap, so
// this stays bounded rather than un-capped for any project size.
const NARRATIVE_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Triggered when a milestone is marked as COMPLETED.
 * Generates impact narratives for all donors of the project, saves impact reports,
 * and sends both push notifications and emails.
 */
export async function triggerMilestoneCompleted(milestoneId: string) {
  try {
    // 1. Fetch milestone, project, and ngo details
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        project: {
          include: {
            ngo: true
          }
        },
        proofs: {
          orderBy: {
            submittedAt: "desc"
          },
          take: 1
        }
      }
    });

    if (!milestone) {
      console.error(`Milestone with ID ${milestoneId} not found in triggerMilestoneCompleted.`);
      return;
    }

    const project = milestone.project;
    const ngo = project.ngo;
    const proofDescription = milestone.proofs[0]?.description || milestone.description;

    // 2. Fetch the next milestone if there is one
    const nextMilestone = await prisma.milestone.findFirst({
      where: {
        projectId: project.id,
        sequenceOrder: milestone.sequenceOrder + 1
      }
    });
    const nextMilestoneTitle = nextMilestone?.title;

    // 3. Fetch all donors who had successful donations to this project
    const donations = await prisma.donation.findMany({
      where: {
        projectId: project.id,
        status: "SUCCESS"
      },
      include: {
        donor: true
      }
    });

    // 4. For each donation, generate narrative, save ImpactReport, and notify.
    // Bounded concurrency (see mapWithConcurrency above) — not all-at-once —
    // so this doesn't burst past Gemini's per-minute quota on projects with
    // more than a handful of donors.
    const results = await mapWithConcurrency(donations, NARRATIVE_CONCURRENCY, async (donation) => {
        const donor = donation.donor;
        
        // Generate the narrative using Gemini
        const result = await generateImpactNarrative(
          donor,
          { amount: Number(donation.amount) },
          { title: project.title, raisedAmount: Number(project.raisedAmount) },
          { orgName: ngo.orgName },
          { title: milestone.title, description: milestone.description },
          proofDescription,
          nextMilestoneTitle
        );

        // Save to ImpactReport
        await prisma.impactReport.create({
          data: {
            donationId: donation.id,
            milestoneId: milestone.id,
            donorId: donor.id,
            aiGeneratedNarrative: result.narrative,
            sdgTags: result.sdgTags,
            irisMetrics: result.irisMetrics,
          }
        });

        // Send push notification to donor
        await sendPushNotification(
          donor.id,
          "Milestone Completed!",
          `Your contribution helped complete the milestone "${milestone.title}" for campaign "${project.title}".`
        );

        // Send email to donor
        if (donor.email) {
          await sendMilestoneCompletedEmail(
            donor.email,
            donor.name,
            project.title,
            ngo.orgName,
            milestone.title,
            result.narrative,
            result.sdgTags,
            result.irisMetrics
          );
        }
    });

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    console.log(`Finished processing triggerMilestoneCompleted for milestone ${milestoneId}. Success: ${results.length - failures.length}, Failed: ${failures.length}`);

    // A failure here means a donor never got their ImpactReport/push/email for
    // this milestone, with no retry — this must be visible, not just a log
    // line nobody is watching (reproduced live: 7/8 donors silently dropped).
    if (failures.length > 0) {
      captureError(
        new Error(`${failures.length}/${donations.length} donor notifications failed for triggerMilestoneCompleted`),
        {
          scope: "notification-triggers",
          operation: "trigger_milestone_completed",
          entityType: "MILESTONE",
          entityId: milestoneId,
          extra: { totalDonors: donations.length, failed: failures.length },
        },
        "warning"
      );
    }
  } catch (error) {
    console.error(`Error in triggerMilestoneCompleted for milestone ${milestoneId}:`, error);
  }
}

/**
 * Triggered when admin approves milestone proof manually.
 * Sends push and email notification to the NGO.
 */
export async function triggerProofApproved(milestoneId: string) {
  try {
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        project: {
          include: {
            ngo: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });

    if (!milestone) {
      console.error(`Milestone ${milestoneId} not found in triggerProofApproved`);
      return;
    }

    const ngoUser = milestone.project.ngo.user;
    const ngoProfile = milestone.project.ngo;

    // Send push to NGO
    await sendPushNotification(
      ngoUser.id,
      "Milestone Proof Approved!",
      `The proof submitted for milestone "${milestone.title}" has been approved.`
    );

    // Send email to NGO
    if (ngoUser.email) {
      await sendProofApprovedEmail(
        ngoUser.email,
        ngoProfile.orgName,
        milestone.title
      );
    }
  } catch (error) {
    console.error(`Error in triggerProofApproved for milestone ${milestoneId}:`, error);
  }
}

/**
 * Triggered when admin rejects milestone proof manually.
 * Sends push and email notification to the NGO.
 */
export async function triggerProofRejected(milestoneId: string, reason: string) {
  try {
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        project: {
          include: {
            ngo: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });

    if (!milestone) {
      console.error(`Milestone ${milestoneId} not found in triggerProofRejected`);
      return;
    }

    const ngoUser = milestone.project.ngo.user;
    const ngoProfile = milestone.project.ngo;

    // Send push to NGO
    await sendPushNotification(
      ngoUser.id,
      "Milestone Proof Rejected",
      `The proof submitted for milestone "${milestone.title}" was not approved. Reason: ${reason}`
    );

    // Send email to NGO
    if (ngoUser.email) {
      await sendProofRejectedEmail(
        ngoUser.email,
        ngoProfile.orgName,
        milestone.title,
        reason
      );
    }
  } catch (error) {
    console.error(`Error in triggerProofRejected for milestone ${milestoneId}:`, error);
  }
}

/**
 * Triggered when a new project is published by an NGO.
 * Sends push and email notifications to all followers of the NGO.
 */
export async function triggerFollowedNGONewProject(ngoId: string, projectId: string) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        ngo: true
      }
    });

    if (!project) {
      console.error(`Project ${projectId} not found in triggerFollowedNGONewProject`);
      return;
    }

    const ngoProfile = project.ngo;

    // Find followers
    const followers = await prisma.nGOFollower.findMany({
      where: { ngoId },
      include: {
        donor: true
      }
    });

    const results = await Promise.allSettled(
      followers.map(async (follower) => {
        const donor = follower.donor;

        // Send push to follower
        await sendPushNotification(
          donor.id,
          "New Project Launched!",
          `${ngoProfile.orgName} just launched a new project: "${project.title}"`
        );

        // Send email to follower
        if (donor.email) {
          await sendNewProjectAlertEmail(
            donor.email,
            donor.name,
            ngoProfile.orgName,
            project.title,
            project.id
          );
        }
      })
    );

    console.log(`Finished processing triggerFollowedNGONewProject for project ${projectId}. Dispatched to ${results.length} followers.`);
  } catch (error) {
    console.error(`Error in triggerFollowedNGONewProject for project ${projectId}:`, error);
  }
}

/**
 * Triggered when a donation is successfully completed.
 * Sends push notification ONLY (no email) to the NGO user.
 */
export async function triggerNewDonationReceived(donationId: string) {
  try {
    const donation = await prisma.donation.findUnique({
      where: { id: donationId },
      include: {
        donor: true,
        project: {
          include: {
            ngo: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });

    if (!donation) {
      console.error(`Donation ${donationId} not found in triggerNewDonationReceived`);
      return;
    }

    const ngoUser = donation.project.ngo.user;
    const projectTitle = donation.project.title;
    const donorName = donation.donor.name || "Anonymous";

    // Send push notification ONLY to the NGO user
    await sendPushNotification(
      ngoUser.id,
      "New Donation Received!",
      `You received a donation of ₹${Number(donation.amount).toLocaleString("en-IN")} from ${donorName} for the project "${projectTitle}".`
    );
  } catch (error) {
    console.error(`Error in triggerNewDonationReceived for donation ${donationId}:`, error);
  }
}
