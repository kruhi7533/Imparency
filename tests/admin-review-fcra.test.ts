import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    nGOCompliance: { updateMany: vi.fn() },
  },
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendFcraApprovalEmail: vi.fn(),
  sendFcraRejectionEmail: vi.fn(),
  sendFcraReuploadEmail: vi.fn(),
}));

vi.mock("@/lib/admin-log", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/ngo-compliance", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ngo-compliance")>("@/lib/ngo-compliance");
  return {
    ...actual,
    logComplianceEvent: vi.fn(),
  };
});

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { sendFcraApprovalEmail, sendFcraRejectionEmail, sendFcraReuploadEmail } from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";
import { POST } from "@/app/api/admin/review-fcra/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;

function ngoWithCompliance(fcraStatus: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "ngo_1",
    orgName: "Asha Rural Development Trust",
    user: { email: "ngo@example.com" },
    compliance: { id: "comp_1", fcraStatus },
    ...overrides,
  };
}

const FUTURE_EXPIRY = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString();

function approveRequest(expiryDate = FUTURE_EXPIRY) {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ ngoId: "ngo_1", action: "APPROVE", expiryDate, adminNote: "Verified with authority." }),
  });
}

function rejectRequest(adminNote = "Certificate number does not match registry.") {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ ngoId: "ngo_1", action: "REJECT", adminNote }),
  });
}

describe("POST /api/admin/review-fcra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    prismaMock.nGOCompliance.updateMany.mockResolvedValue({ count: 1 });
  });

  it("approves an FCRA submission genuinely awaiting review", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("PENDING"));

    const res = await POST(approveRequest());

    expect(res.status).toBe(200);
    // Conditioned on the status still being reviewable, not a bare update by id.
    expect(prismaMock.nGOCompliance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "comp_1", fcraStatus: { in: ["PENDING", "REUPLOAD_REQUESTED"] } },
      })
    );
    expect(sendFcraApprovalEmail).toHaveBeenCalledWith("ngo@example.com", "Asha Rural Development Trust");
  });

  it("also allows review after a re-upload was requested", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("REUPLOAD_REQUESTED"));

    const res = await POST(approveRequest());

    expect(res.status).toBe(200);
  });

  it("refuses to approve an FCRA record that is already ACTIVE", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("ACTIVE"));

    const res = await POST(approveRequest());

    expect(res.status).toBe(409);
    expect(prismaMock.nGOCompliance.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to act on an FCRA record that was never submitted", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("NONE"));

    const res = await POST(rejectRequest());

    expect(res.status).toBe(409);
    expect(prismaMock.nGOCompliance.updateMany).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent admin decided the submission first", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("PENDING"));
    prismaMock.nGOCompliance.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(approveRequest());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("just decided by another admin"),
    });
    expect(sendFcraApprovalEmail).not.toHaveBeenCalled();
  });

  it("rejects approving an already-expired certificate", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("PENDING"));
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const res = await POST(approveRequest(pastDate));

    expect(res.status).toBe(400);
    expect(prismaMock.nGOCompliance.updateMany).not.toHaveBeenCalled();
  });

  it("requires an expiry date to approve", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("PENDING"));

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ ngoId: "ngo_1", action: "APPROVE" }),
      })
    );

    expect(res.status).toBe(400);
  });

  it("requires a note to reject", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("PENDING"));

    const res = await POST(rejectRequest(""));

    expect(res.status).toBe(400);
    expect(prismaMock.nGOCompliance.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an FCRA submission", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("PENDING"));

    const res = await POST(rejectRequest("Certificate number does not match registry."));

    expect(res.status).toBe(200);
    expect(prismaMock.nGOCompliance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fcraStatus: "REJECTED" }) })
    );
    expect(sendFcraRejectionEmail).toHaveBeenCalledWith(
      "ngo@example.com",
      "Asha Rural Development Trust",
      "Certificate number does not match registry."
    );
  });

  it("requests a re-upload distinctly from a rejection", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("PENDING"));

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ ngoId: "ngo_1", action: "REUPLOAD", adminNote: "Scan is cut off at the edges." }),
      })
    );

    expect(res.status).toBe(200);
    expect(prismaMock.nGOCompliance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fcraStatus: "REUPLOAD_REQUESTED" }) })
    );
    expect(sendFcraReuploadEmail).toHaveBeenCalled();
    expect(sendFcraRejectionEmail).not.toHaveBeenCalled();
  });

  it("returns 404 when the NGO or its compliance record is missing", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(null);

    const res = await POST(approveRequest());

    expect(res.status).toBe(404);
  });

  it("logs the audit trail with the prior status recorded", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(ngoWithCompliance("PENDING"));

    await POST(approveRequest());

    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "FCRA_APPROVED",
        entityType: "FCRA",
        oldValue: { fcraStatus: "PENDING" },
      })
    );
  });

  it("returns 403 for a non-admin caller", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });

    const res = await POST(approveRequest());

    expect(res.status).toBe(403);
    expect(prismaMock.nGOProfile.findUnique).not.toHaveBeenCalled();
  });
});
