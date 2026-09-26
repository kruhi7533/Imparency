import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    milestone: { findUnique: vi.fn(), updateMany: vi.fn() },
    milestoneReview: { create: vi.fn() },
    adminActionLog: { create: vi.fn() },
  },
}));

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Side-effect modules the route fans out to after a decision lands. Stubbed so
// the tests assert the decision logic, not the notification pipeline.
vi.mock("@/lib/notification-triggers", () => ({
  triggerMilestoneCompleted: vi.fn(),
  triggerProofApproved: vi.fn(),
  triggerProofRejected: vi.fn(),
}));
vi.mock("@/lib/ngo-health", () => ({
  recalculateNGOHealthScore: vi.fn(),
}));
vi.mock("@/lib/impact-events", () => ({
  emitProjectImpactEvent: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { triggerMilestoneCompleted } from "@/lib/notification-triggers";
import { POST } from "@/app/api/admin/review-proof/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;
const triggerMilestoneCompletedMock = triggerMilestoneCompleted as any;

/** A milestone sitting in the queue with a clean, high-scoring proof attached. */
function reviewableMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: "ms_1",
    title: "Procure van chassis",
    status: "PROOF_SUBMITTED",
    projectId: "proj_1",
    project: { id: "proj_1", title: "Healthcare Van", ngoId: "ngo_1" },
    proofs: [
      {
        id: "proof_1",
        aiValidationScore: 85,
        aiValidationResult: null,
        mediaUrls: [],
      },
    ],
    ...overrides,
  };
}

function approveRequest() {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ milestoneId: "ms_1", action: "APPROVE" }),
  });
}

describe("POST /api/admin/review-proof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    prismaMock.milestone.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.milestoneReview.create.mockResolvedValue({ id: "rev_1" });
    prismaMock.adminActionLog.create.mockResolvedValue({ id: "log_1" });
  });

  it("approves a milestone that is genuinely awaiting review", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(reviewableMilestone());

    const res = await POST(approveRequest());

    expect(res.status).toBe(200);
    // The write must be conditioned on the status, not a bare update by id.
    expect(prismaMock.milestone.updateMany).toHaveBeenCalledWith({
      where: { id: "ms_1", status: "PROOF_SUBMITTED" },
      data: { status: "COMPLETED" },
    });
  });

  it("refuses to release funds for a milestone with no submitted proof", async () => {
    // The gap that mattered: with no proof row, aiScore is null, so both the
    // AI-override and budget-rule gates pass vacuously.
    prismaMock.milestone.findUnique.mockResolvedValue(reviewableMilestone({ proofs: [] }));

    const res = await POST(approveRequest());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("no submitted proof"),
    });
    expect(prismaMock.milestone.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to re-approve an already completed milestone", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(
      reviewableMilestone({ status: "COMPLETED" })
    );

    const res = await POST(approveRequest());

    expect(res.status).toBe(409);
    expect(prismaMock.milestone.updateMany).not.toHaveBeenCalled();
    // Donors must not be told a second time that this milestone completed.
    expect(triggerMilestoneCompletedMock).not.toHaveBeenCalled();
  });

  it("refuses to act on a milestone that has not reached review yet", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(
      reviewableMilestone({ status: "IN_PROGRESS", proofs: [] })
    );

    const res = await POST(approveRequest());

    expect(res.status).toBe(409);
    expect(prismaMock.milestone.updateMany).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent admin decided the milestone first", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(reviewableMilestone());
    // The conditional write matched zero rows: someone else won the race between
    // our read and our write.
    prismaMock.milestone.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(approveRequest());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("just decided by another admin"),
    });
    // Critically: no review row, no donor notification, no impact event.
    expect(prismaMock.milestoneReview.create).not.toHaveBeenCalled();
    expect(triggerMilestoneCompletedMock).not.toHaveBeenCalled();
  });

  it("still requires a written justification to override a low AI score", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(
      reviewableMilestone({
        proofs: [{ id: "proof_1", aiValidationScore: 12, aiValidationResult: null, mediaUrls: [] }],
      })
    );

    const res = await POST(approveRequest());

    expect(res.status).toBe(400);
    expect(prismaMock.milestone.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a proof and returns the milestone to in-progress", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(reviewableMilestone());

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          milestoneId: "ms_1",
          action: "REJECT",
          rejectionReason: "Receipts do not match the stated budget line.",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(prismaMock.milestone.updateMany).toHaveBeenCalledWith({
      where: { id: "ms_1", status: "PROOF_SUBMITTED" },
      data: { status: "IN_PROGRESS" },
    });
  });

  it("returns 403 for a non-admin caller", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });

    const res = await POST(approveRequest());

    expect(res.status).toBe(403);
    expect(prismaMock.milestone.findUnique).not.toHaveBeenCalled();
  });
});
