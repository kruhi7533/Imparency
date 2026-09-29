import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * notification-triggers.ts is the fan-out layer: one milestone completion turns
 * into an AI narrative, an ImpactReport row, a push, and an email per donor. It
 * had zero coverage despite two properties that have already failed in
 * production according to the comments in the file itself:
 *
 *  - the Gemini per-minute quota, which is why narrative generation is capped
 *    at NARRATIVE_CONCURRENCY=3 rather than fired all at once (7 of 8 donors
 *    got 429s before the cap existed);
 *  - partial failure, which used to be a log line nobody watched. A dropped
 *    donor must now reach captureError.
 *
 * Both are pinned here, along with the privacy rule from CLAUDE.md: error
 * context carries ids and counts only — never a donor name, email, or amount.
 */

const prismaMock = vi.hoisted(() => ({
  milestone: { findUnique: vi.fn(), findFirst: vi.fn() },
  donation: { findMany: vi.fn(), findUnique: vi.fn() },
  impactReport: { create: vi.fn() },
  project: { findUnique: vi.fn() },
  nGOFollower: { findMany: vi.fn() },
}));

const generateImpactNarrative = vi.hoisted(() => vi.fn());
const sendPushNotification = vi.hoisted(() => vi.fn());
const sendMilestoneCompletedEmail = vi.hoisted(() => vi.fn());
const sendProofApprovedEmail = vi.hoisted(() => vi.fn());
const sendProofRejectedEmail = vi.hoisted(() => vi.fn());
const sendNewProjectAlertEmail = vi.hoisted(() => vi.fn());
const captureError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/gemini/generate-narrative", () => ({ generateImpactNarrative }));
vi.mock("@/lib/notification", () => ({ sendPushNotification }));
vi.mock("@/lib/email", () => ({
  sendMilestoneCompletedEmail,
  sendProofApprovedEmail,
  sendProofRejectedEmail,
  sendNewProjectAlertEmail,
}));
vi.mock("@/lib/observability", () => ({ captureError }));

import {
  triggerMilestoneCompleted,
  triggerProofApproved,
  triggerProofRejected,
  triggerFollowedNGONewProject,
  triggerNewDonationReceived,
} from "@/lib/notification-triggers";

/** A milestone with its project/ngo graph, as the trigger's include produces it. */
function milestoneGraph(over: Record<string, any> = {}) {
  return {
    id: "m-1",
    title: "Phase 1 delivery",
    description: "Install forty solar lamps",
    sequenceOrder: 1,
    proofs: [{ description: "Forty lamps installed and photographed" }],
    project: {
      id: "p-1",
      title: "Solar Learning Center",
      raisedAmount: 500000,
      ngo: {
        id: "ngo-1",
        orgName: "Helping Hands",
        user: { id: "user-ngo-1", email: "ngo@example.org" },
      },
    },
    ...over,
  };
}

function donationRows(count: number, over: (i: number) => Record<string, any> = () => ({})) {
  return Array.from({ length: count }, (_, i) => ({
    id: `don-${i}`,
    amount: 1000 + i,
    donor: { id: `donor-${i}`, name: `Donor ${i}`, email: `donor${i}@example.com` },
    ...over(i),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  generateImpactNarrative.mockResolvedValue({
    narrative: "Forty classrooms now have light after sunset.",
    sdgTags: ["SDG4"],
    irisMetrics: ["PI1234"],
  });
  sendPushNotification.mockResolvedValue(undefined);
  sendMilestoneCompletedEmail.mockResolvedValue({ success: true });
  sendProofApprovedEmail.mockResolvedValue({ success: true });
  sendProofRejectedEmail.mockResolvedValue({ success: true });
  sendNewProjectAlertEmail.mockResolvedValue({ success: true });
  prismaMock.impactReport.create.mockResolvedValue({ id: "ir-1" });
  prismaMock.milestone.findFirst.mockResolvedValue(null);
});

describe("triggerMilestoneCompleted — per-donor fan-out", () => {
  beforeEach(() => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph());
    prismaMock.donation.findMany.mockResolvedValue(donationRows(3));
  });

  it("writes one ImpactReport, one push and one email per successful donor", async () => {
    await triggerMilestoneCompleted("m-1");

    expect(generateImpactNarrative).toHaveBeenCalledTimes(3);
    expect(prismaMock.impactReport.create).toHaveBeenCalledTimes(3);
    expect(sendPushNotification).toHaveBeenCalledTimes(3);
    expect(sendMilestoneCompletedEmail).toHaveBeenCalledTimes(3);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("links each ImpactReport to the donation, milestone and donor it belongs to", async () => {
    await triggerMilestoneCompleted("m-1");

    const first = prismaMock.impactReport.create.mock.calls[0][0].data;
    expect(first).toMatchObject({
      donationId: "don-0",
      milestoneId: "m-1",
      donorId: "donor-0",
      aiGeneratedNarrative: "Forty classrooms now have light after sunset.",
      sdgTags: ["SDG4"],
      irisMetrics: ["PI1234"],
    });
  });

  it("passes the AI's own tags through to the donor email rather than re-deriving them", async () => {
    await triggerMilestoneCompleted("m-1");

    const args = sendMilestoneCompletedEmail.mock.calls[0];
    expect(args[5]).toBe("Forty classrooms now have light after sunset.");
    expect(args[6]).toEqual(["SDG4"]);
    expect(args[7]).toEqual(["PI1234"]);
  });

  it("skips the email but still pushes for a donor with no email on file", async () => {
    prismaMock.donation.findMany.mockResolvedValue(
      donationRows(2, (i) =>
        i === 0 ? { donor: { id: "donor-0", name: "Donor 0", email: null } } : {}
      )
    );

    await triggerMilestoneCompleted("m-1");

    expect(sendPushNotification).toHaveBeenCalledTimes(2);
    expect(sendMilestoneCompletedEmail).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all when the project has no successful donations", async () => {
    prismaMock.donation.findMany.mockResolvedValue([]);
    await triggerMilestoneCompleted("m-1");

    expect(generateImpactNarrative).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("only counts donations that actually succeeded", async () => {
    await triggerMilestoneCompleted("m-1");

    expect(prismaMock.donation.findMany.mock.calls[0][0].where).toMatchObject({
      projectId: "p-1",
      status: "SUCCESS",
    });
  });
});

describe("triggerMilestoneCompleted — the Gemini concurrency cap", () => {
  it("never runs more than three narrative generations at once", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph());
    prismaMock.donation.findMany.mockResolvedValue(donationRows(12));

    let inFlight = 0;
    let peak = 0;
    generateImpactNarrative.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { narrative: "n", sdgTags: [], irisMetrics: [] };
    });

    await triggerMilestoneCompleted("m-1");

    expect(generateImpactNarrative).toHaveBeenCalledTimes(12);
    // The cap exists because the free tier allows 5 req/min; 3 is the ceiling.
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("still processes every donor when there are fewer donors than the cap", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph());
    prismaMock.donation.findMany.mockResolvedValue(donationRows(2));

    await triggerMilestoneCompleted("m-1");
    expect(prismaMock.impactReport.create).toHaveBeenCalledTimes(2);
  });
});

describe("triggerMilestoneCompleted — partial failure must be visible", () => {
  beforeEach(() => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph());
    prismaMock.donation.findMany.mockResolvedValue(donationRows(4));
  });

  it("carries on with the other donors when one narrative call fails", async () => {
    generateImpactNarrative
      .mockRejectedValueOnce(new Error("429 quota exceeded"))
      .mockResolvedValue({ narrative: "n", sdgTags: [], irisMetrics: [] });

    await triggerMilestoneCompleted("m-1");

    // 4 attempted, 1 failed before its report was written -> 3 reports.
    expect(generateImpactNarrative).toHaveBeenCalledTimes(4);
    expect(prismaMock.impactReport.create).toHaveBeenCalledTimes(3);
  });

  it("reports the dropped donor through captureError rather than only logging", async () => {
    generateImpactNarrative
      .mockRejectedValueOnce(new Error("429 quota exceeded"))
      .mockResolvedValue({ narrative: "n", sdgTags: [], irisMetrics: [] });

    await triggerMilestoneCompleted("m-1");

    expect(captureError).toHaveBeenCalledTimes(1);
    const [error, context, level] = captureError.mock.calls[0];
    expect(String(error.message)).toContain("1/4");
    expect(level).toBe("warning");
    expect(context).toMatchObject({
      scope: "notification-triggers",
      entityType: "MILESTONE",
      entityId: "m-1",
      extra: { totalDonors: 4, failed: 1 },
    });
  });

  it("keeps donor PII out of the captured error context", async () => {
    // CLAUDE.md: audit and error context carry ids only — never names, emails
    // or amounts. The context here must survive that rule.
    generateImpactNarrative.mockRejectedValue(new Error("everything failed"));

    await triggerMilestoneCompleted("m-1");

    const serialised = JSON.stringify(captureError.mock.calls[0][1]);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain("Donor 0");
    expect(serialised).not.toContain("1000");
  });

  it("does not raise captureError when every donor succeeded", async () => {
    await triggerMilestoneCompleted("m-1");
    expect(captureError).not.toHaveBeenCalled();
  });

  it("reports every donor as failed when the failure is total", async () => {
    generateImpactNarrative.mockRejectedValue(new Error("provider down"));

    await triggerMilestoneCompleted("m-1");

    expect(captureError.mock.calls[0][1].extra).toEqual({ totalDonors: 4, failed: 4 });
  });
});

describe("triggerMilestoneCompleted — narrative inputs", () => {
  it("prefers the latest proof's description as the evidence summary", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph());
    prismaMock.donation.findMany.mockResolvedValue(donationRows(1));

    await triggerMilestoneCompleted("m-1");

    expect(generateImpactNarrative.mock.calls[0][5]).toBe(
      "Forty lamps installed and photographed"
    );
  });

  it("falls back to the milestone description when no proof carries one", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph({ proofs: [] }));
    prismaMock.donation.findMany.mockResolvedValue(donationRows(1));

    await triggerMilestoneCompleted("m-1");

    expect(generateImpactNarrative.mock.calls[0][5]).toBe("Install forty solar lamps");
  });

  it("looks up the next milestone by sequence order so the narrative can tease it", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph({ sequenceOrder: 4 }));
    prismaMock.donation.findMany.mockResolvedValue(donationRows(1));
    prismaMock.milestone.findFirst.mockResolvedValue({ title: "Phase 2 rollout" });

    await triggerMilestoneCompleted("m-1");

    expect(prismaMock.milestone.findFirst.mock.calls[0][0].where).toMatchObject({
      projectId: "p-1",
      sequenceOrder: 5,
    });
    expect(generateImpactNarrative.mock.calls[0][6]).toBe("Phase 2 rollout");
  });

  it("passes no next-milestone title when this was the final milestone", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph());
    prismaMock.donation.findMany.mockResolvedValue(donationRows(1));
    prismaMock.milestone.findFirst.mockResolvedValue(null);

    await triggerMilestoneCompleted("m-1");

    expect(generateImpactNarrative.mock.calls[0][6]).toBeUndefined();
  });
});

describe("triggerProofApproved / triggerProofRejected", () => {
  beforeEach(() => {
    prismaMock.milestone.findUnique.mockResolvedValue(milestoneGraph());
  });

  it("notifies the NGO's own user, not the donor, on approval", async () => {
    await triggerProofApproved("m-1");

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(sendPushNotification.mock.calls[0][0]).toBe("user-ngo-1");
    expect(sendProofApprovedEmail).toHaveBeenCalledWith(
      "ngo@example.org",
      "Helping Hands",
      "Phase 1 delivery"
    );
  });

  it("carries the reviewer's reason into both the push and the email on rejection", async () => {
    await triggerProofRejected("m-1", "Receipt total does not match the budget");

    expect(sendPushNotification.mock.calls[0][2]).toContain(
      "Receipt total does not match the budget"
    );
    expect(sendProofRejectedEmail).toHaveBeenCalledWith(
      "ngo@example.org",
      "Helping Hands",
      "Phase 1 delivery",
      "Receipt total does not match the budget"
    );
  });

  it("skips the email but still pushes when the NGO user has no address", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(
      milestoneGraph({
        project: {
          ...milestoneGraph().project,
          ngo: { id: "ngo-1", orgName: "Helping Hands", user: { id: "user-ngo-1", email: null } },
        },
      })
    );

    await triggerProofApproved("m-1");

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(sendProofApprovedEmail).not.toHaveBeenCalled();
  });
});

describe("triggerFollowedNGONewProject", () => {
  beforeEach(() => {
    prismaMock.project.findUnique.mockResolvedValue({
      id: "p-1",
      title: "Solar Learning Center",
      ngo: { id: "ngo-1", orgName: "Helping Hands" },
    });
  });

  it("notifies every follower of the NGO", async () => {
    prismaMock.nGOFollower.findMany.mockResolvedValue([
      { donor: { id: "d-1", name: "Asha", email: "asha@example.com" } },
      { donor: { id: "d-2", name: "Ravi", email: "ravi@example.com" } },
    ]);

    await triggerFollowedNGONewProject("ngo-1", "p-1");

    expect(sendPushNotification).toHaveBeenCalledTimes(2);
    expect(sendNewProjectAlertEmail).toHaveBeenCalledTimes(2);
    expect(sendNewProjectAlertEmail.mock.calls[0]).toEqual([
      "asha@example.com",
      "Asha",
      "Helping Hands",
      "Solar Learning Center",
      "p-1",
    ]);
  });

  it("scopes the follower lookup to the NGO it was asked about", async () => {
    prismaMock.nGOFollower.findMany.mockResolvedValue([]);
    await triggerFollowedNGONewProject("ngo-1", "p-1");

    expect(prismaMock.nGOFollower.findMany.mock.calls[0][0].where).toEqual({ ngoId: "ngo-1" });
  });

  it("does not throw when the NGO has no followers yet", async () => {
    prismaMock.nGOFollower.findMany.mockResolvedValue([]);

    await expect(triggerFollowedNGONewProject("ngo-1", "p-1")).resolves.toBeUndefined();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("still reaches the other followers when one push fails", async () => {
    prismaMock.nGOFollower.findMany.mockResolvedValue([
      { donor: { id: "d-1", name: "Asha", email: "asha@example.com" } },
      { donor: { id: "d-2", name: "Ravi", email: "ravi@example.com" } },
    ]);
    sendPushNotification.mockRejectedValueOnce(new Error("no device token"));

    await expect(triggerFollowedNGONewProject("ngo-1", "p-1")).resolves.toBeUndefined();
    expect(sendPushNotification).toHaveBeenCalledTimes(2);
  });
});

describe("triggerNewDonationReceived", () => {
  it("pushes to the NGO and deliberately sends no email", async () => {
    prismaMock.donation.findUnique.mockResolvedValue({
      id: "don-1",
      amount: 150000,
      donor: { id: "d-1", name: "Asha" },
      project: {
        title: "Solar Learning Center",
        ngo: { orgName: "Helping Hands", user: { id: "user-ngo-1", email: "ngo@example.org" } },
      },
    });

    await triggerNewDonationReceived("don-1");

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(sendPushNotification.mock.calls[0][0]).toBe("user-ngo-1");
    expect(sendMilestoneCompletedEmail).not.toHaveBeenCalled();
    expect(sendNewProjectAlertEmail).not.toHaveBeenCalled();
  });

  it("formats the amount in the Indian numbering system", async () => {
    prismaMock.donation.findUnique.mockResolvedValue({
      id: "don-1",
      amount: 150000,
      donor: { id: "d-1", name: "Asha" },
      project: {
        title: "Solar Learning Center",
        ngo: { orgName: "Helping Hands", user: { id: "user-ngo-1", email: "ngo@example.org" } },
      },
    });

    await triggerNewDonationReceived("don-1");

    expect(sendPushNotification.mock.calls[0][2]).toContain("₹1,50,000");
  });

  it("calls an unnamed donor Anonymous rather than printing null", async () => {
    prismaMock.donation.findUnique.mockResolvedValue({
      id: "don-1",
      amount: 500,
      donor: { id: "d-1", name: null },
      project: {
        title: "Solar Learning Center",
        ngo: { orgName: "Helping Hands", user: { id: "user-ngo-1", email: "ngo@example.org" } },
      },
    });

    await triggerNewDonationReceived("don-1");

    const body = sendPushNotification.mock.calls[0][2];
    expect(body).toContain("Anonymous");
    expect(body).not.toContain("null");
  });
});

describe("missing entities are swallowed, never thrown", () => {
  // Every trigger is called fire-and-forget from a request handler, so a
  // throw here would surface as a 500 on an action that actually succeeded.
  it("returns quietly when the milestone does not exist", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(null);

    await expect(triggerMilestoneCompleted("ghost")).resolves.toBeUndefined();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("returns quietly when the milestone is missing on proof approval", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(null);

    await expect(triggerProofApproved("ghost")).resolves.toBeUndefined();
    expect(sendProofApprovedEmail).not.toHaveBeenCalled();
  });

  it("returns quietly when the milestone is missing on proof rejection", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(null);

    await expect(triggerProofRejected("ghost", "reason")).resolves.toBeUndefined();
    expect(sendProofRejectedEmail).not.toHaveBeenCalled();
  });

  it("returns quietly when the project does not exist", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);

    await expect(triggerFollowedNGONewProject("ngo-1", "ghost")).resolves.toBeUndefined();
    expect(sendNewProjectAlertEmail).not.toHaveBeenCalled();
  });

  it("returns quietly when the donation does not exist", async () => {
    prismaMock.donation.findUnique.mockResolvedValue(null);

    await expect(triggerNewDonationReceived("ghost")).resolves.toBeUndefined();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("swallows a database failure rather than propagating it", async () => {
    prismaMock.milestone.findUnique.mockRejectedValue(new Error("connection lost"));

    await expect(triggerMilestoneCompleted("m-1")).resolves.toBeUndefined();
  });
});
