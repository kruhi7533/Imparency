import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    riskReview: { findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    nGOProfile: { update: vi.fn() },
    notification: { create: vi.fn() },
    fraudAlert: { count: vi.fn() },
  },
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendNGOSuspendedEmail: vi.fn(),
  sendNGOReinstatedEmail: vi.fn(),
}));

vi.mock("@/lib/admin-log", () => ({
  logAdminAction: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { sendNGOSuspendedEmail, sendNGOReinstatedEmail } from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";
import { POST } from "@/app/api/admin/risk/review/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;

function openReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev_1",
    ngoId: "ngo_1",
    riskLevel: "HIGH",
    status: "OPEN",
    ngo: {
      id: "ngo_1",
      orgName: "Asha Rural Development Trust",
      isSuspended: false,
      userId: "user_1",
      user: { email: "ngo@example.com" },
    },
    ...overrides,
  };
}

// The route type-annotates the handler's request as NextRequest, but only
// calls req.json() on it — a plain Request satisfies that at runtime.
function request(body: Record<string, unknown>) {
  return new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/admin/risk/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    prismaMock.riskReview.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.riskReview.count.mockResolvedValue(0);
    prismaMock.fraudAlert.count.mockResolvedValue(0);
  });

  it("suspends the NGO and notifies it", async () => {
    prismaMock.riskReview.findUnique.mockResolvedValue(openReview());

    const res = await POST(request({ reviewId: "rev_1", action: "SUSPEND", reviewNote: "Repeated low-score proofs." }) as any);

    expect(res.status).toBe(200);
    // The claim must be conditioned on the review still being OPEN.
    expect(prismaMock.riskReview.updateMany).toHaveBeenCalledWith({
      where: { id: "rev_1", status: "OPEN" },
      data: expect.objectContaining({ status: "SUSPENDED", reviewNote: "Repeated low-score proofs." }),
    });
    expect(prismaMock.nGOProfile.update).toHaveBeenCalledWith({
      where: { id: "ngo_1" },
      data: expect.objectContaining({ isSuspended: true }),
    });
    expect(sendNGOSuspendedEmail).toHaveBeenCalled();
  });

  it("claims the review before running any side effect, so a race loses cleanly", async () => {
    prismaMock.riskReview.findUnique.mockResolvedValue(openReview());
    // Someone else's request already flipped this review's status first.
    prismaMock.riskReview.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(request({ reviewId: "rev_1", action: "SUSPEND", reviewNote: "Repeated low-score proofs." }) as any);

    expect(res.status).toBe(409);
    expect(prismaMock.nGOProfile.update).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    expect(sendNGOSuspendedEmail).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it("refuses to act again on a review that was already resolved", async () => {
    // Even if a caller somehow still has a stale review object with an old
    // status, the atomic claim (not the earlier findUnique) is what decides.
    prismaMock.riskReview.findUnique.mockResolvedValue(openReview({ status: "SUSPENDED" }));
    prismaMock.riskReview.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(request({ reviewId: "rev_1", action: "CLEAR", reviewNote: "Reinstating after appeal." }) as any);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("already decided"),
    });
  });

  it("reinstates a suspended NGO when nothing else is blocking it", async () => {
    prismaMock.riskReview.findUnique.mockResolvedValue(openReview({ ngo: { ...openReview().ngo, isSuspended: true } }));
    prismaMock.riskReview.count.mockResolvedValue(0);
    prismaMock.fraudAlert.count.mockResolvedValue(0);

    const res = await POST(request({ reviewId: "rev_1", action: "CLEAR", reviewNote: "Appeal upheld." }) as any);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "CLEARED" });
    expect(prismaMock.nGOProfile.update).toHaveBeenCalledWith({
      where: { id: "ngo_1" },
      data: { isSuspended: false, suspensionReason: null, suspendedAt: null },
    });
    expect(sendNGOReinstatedEmail).toHaveBeenCalled();
  });

  it("clears the review but keeps the NGO suspended when another open review still exists", async () => {
    prismaMock.riskReview.findUnique.mockResolvedValue(openReview({ ngo: { ...openReview().ngo, isSuspended: true } }));
    // A second, unrelated risk review is still open against the same NGO.
    prismaMock.riskReview.count.mockResolvedValue(1);
    prismaMock.fraudAlert.count.mockResolvedValue(0);

    const res = await POST(request({ reviewId: "rev_1", action: "CLEAR", reviewNote: "This particular claim was unfounded." }) as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "CLEARED", reinstated: false });
    expect(body.warning).toContain("1 other open risk review");
    // Must not touch isSuspended — another ground for suspension is still open.
    expect(prismaMock.nGOProfile.update).not.toHaveBeenCalled();
    expect(sendNGOReinstatedEmail).not.toHaveBeenCalled();
  });

  it("clears the review but keeps the NGO suspended when an unresolved HIGH fraud alert still exists", async () => {
    prismaMock.riskReview.findUnique.mockResolvedValue(openReview({ ngo: { ...openReview().ngo, isSuspended: true } }));
    prismaMock.riskReview.count.mockResolvedValue(0);
    prismaMock.fraudAlert.count.mockResolvedValue(1);

    const res = await POST(request({ reviewId: "rev_1", action: "CLEAR", reviewNote: "This particular claim was unfounded." }) as any);

    const body = await res.json();
    expect(body.reinstated).toBe(false);
    expect(prismaMock.nGOProfile.update).not.toHaveBeenCalled();
  });

  it("clearing a review on an NGO that was never suspended does not touch NGOProfile", async () => {
    prismaMock.riskReview.findUnique.mockResolvedValue(openReview({ ngo: { ...openReview().ngo, isSuspended: false } }));

    const res = await POST(request({ reviewId: "rev_1", action: "CLEAR", reviewNote: "No suspension was ever applied." }) as any);

    expect(res.status).toBe(200);
    expect(prismaMock.nGOProfile.update).not.toHaveBeenCalled();
  });

  it("escalates without suspending or reinstating anything", async () => {
    prismaMock.riskReview.findUnique.mockResolvedValue(openReview());

    const res = await POST(request({ reviewId: "rev_1", action: "ESCALATE", reviewNote: "Needs a second opinion." }) as any);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ESCALATED" });
    expect(prismaMock.nGOProfile.update).not.toHaveBeenCalled();
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RISK_REVIEW_ESCALATED" })
    );
  });

  it("requires a review note", async () => {
    const res = await POST(request({ reviewId: "rev_1", action: "SUSPEND", reviewNote: "  " }) as any);

    expect(res.status).toBe(400);
    expect(prismaMock.riskReview.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid action", async () => {
    const res = await POST(request({ reviewId: "rev_1", action: "DELETE", reviewNote: "note" }) as any);

    expect(res.status).toBe(400);
  });

  it("returns 404 for a review that does not exist", async () => {
    prismaMock.riskReview.findUnique.mockResolvedValue(null);

    const res = await POST(request({ reviewId: "missing", action: "SUSPEND", reviewNote: "note" }) as any);

    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-admin caller", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });

    const res = await POST(request({ reviewId: "rev_1", action: "SUSPEND", reviewNote: "note" }) as any);

    expect(res.status).toBe(403);
    expect(prismaMock.riskReview.findUnique).not.toHaveBeenCalled();
  });
});
