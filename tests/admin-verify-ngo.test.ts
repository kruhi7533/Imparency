import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn(), updateMany: vi.fn() },
    nGOCompliance: { upsert: vi.fn() },
  },
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendNGOApprovalEmail: vi.fn(),
  sendNGORejectionEmail: vi.fn(),
}));

vi.mock("@/lib/admin-log", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/ngo-compliance", () => ({
  logComplianceEvent: vi.fn(),
}));

vi.mock("@/lib/gemini/explain-rejection", () => ({
  composeRejectionGuidance: vi.fn().mockResolvedValue("Rewritten NGO-facing note."),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { sendNGOApprovalEmail, sendNGORejectionEmail } from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";
import { POST } from "@/app/api/admin/verify-ngo/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;
const logAdminActionMock = logAdminAction as any;

function pendingNgo(overrides: Record<string, unknown> = {}) {
  return {
    id: "ngo_1",
    orgName: "Sahyog Foundation",
    verificationStatus: "PENDING",
    ai_verification_report: null,
    user: { email: "ngo@example.com" },
    screening: null,
    compliance: { id: "comp_1", a12DocumentUrl: null },
    ...overrides,
  };
}

function approveRequest(adminNote?: string) {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ ngoId: "ngo_1", action: "APPROVE", adminNote }),
  });
}

function rejectRequest(adminNote?: string) {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ ngoId: "ngo_1", action: "REJECT", adminNote }),
  });
}

describe("POST /api/admin/verify-ngo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    prismaMock.nGOProfile.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.nGOCompliance.upsert.mockResolvedValue({ id: "comp_1" });
  });

  it("approves an NGO genuinely awaiting verification", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());

    const res = await POST(approveRequest());

    expect(res.status).toBe(200);
    // The write must be conditioned on the status still being PENDING, not a
    // bare update by id — otherwise two admins deciding at once both "win".
    expect(prismaMock.nGOProfile.updateMany).toHaveBeenCalledWith({
      where: { id: "ngo_1", verificationStatus: "PENDING" },
      data: { verificationStatus: "VERIFIED", adminNote: "All documents verified successfully." },
    });
    expect(sendNGOApprovalEmail).toHaveBeenCalledWith("ngo@example.com", "Sahyog Foundation");
  });

  it("records per-document compliance verification on approval", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());

    await POST(approveRequest());

    expect(prismaMock.nGOCompliance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ngoId: "ngo_1" },
        update: expect.objectContaining({ panVerified: true, registrationVerified: true, eightyGVerified: true }),
      })
    );
  });

  it("does not mark 12A verified when no 12A document was supplied", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());

    await POST(approveRequest());

    const upsertArg = prismaMock.nGOCompliance.upsert.mock.calls[0][0];
    expect(upsertArg.update.a12Verified).toBeUndefined();
  });

  it("refuses to re-verify an NGO that is already VERIFIED", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo({ verificationStatus: "VERIFIED" }));

    const res = await POST(approveRequest());

    expect(res.status).toBe(409);
    expect(prismaMock.nGOProfile.updateMany).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent admin decided the NGO first", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());
    // The conditional write matched zero rows — someone else won the race
    // between our read and our write.
    prismaMock.nGOProfile.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(approveRequest());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("just decided by another admin"),
    });
    expect(prismaMock.nGOCompliance.upsert).not.toHaveBeenCalled();
    expect(logAdminActionMock).not.toHaveBeenCalled();
  });

  it("requires a justification note to approve against an AI fraud recommendation", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(
      pendingNgo({ ai_verification_report: { recommendation: "LIKELY_FRAUD", flags: [] } })
    );

    const res = await POST(approveRequest());

    expect(res.status).toBe(400);
    expect(prismaMock.nGOProfile.updateMany).not.toHaveBeenCalled();
  });

  it("allows approval against an AI fraud recommendation once a justification is given", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(
      pendingNgo({ ai_verification_report: { recommendation: "LIKELY_FRAUD", flags: [] } })
    );

    const res = await POST(approveRequest("Manually verified registration certificate with the issuing authority."));

    expect(res.status).toBe(200);
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ overrodeAi: true }) })
    );
  });

  it("requires a rejection note", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());

    const res = await POST(rejectRequest(""));

    expect(res.status).toBe(400);
    expect(prismaMock.nGOProfile.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an NGO and sends the composed guidance note", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());

    const res = await POST(rejectRequest("PAN document is illegible."));

    expect(res.status).toBe(200);
    expect(prismaMock.nGOProfile.updateMany).toHaveBeenCalledWith({
      where: { id: "ngo_1", verificationStatus: "PENDING" },
      data: { verificationStatus: "REJECTED", adminNote: "Rewritten NGO-facing note." },
    });
    expect(sendNGORejectionEmail).toHaveBeenCalledWith(
      "ngo@example.com",
      "Sahyog Foundation",
      "Rewritten NGO-facing note."
    );
    // Rejection must never touch compliance verification fields.
    expect(prismaMock.nGOCompliance.upsert).not.toHaveBeenCalled();
  });

  it("returns 404 for an NGO that does not exist", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(null);

    const res = await POST(approveRequest());

    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-admin caller", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });

    const res = await POST(approveRequest());

    expect(res.status).toBe(403);
    expect(prismaMock.nGOProfile.findUnique).not.toHaveBeenCalled();
  });
});
