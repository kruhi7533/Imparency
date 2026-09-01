import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn(), updateMany: vi.fn() },
    nGOCompliance: { upsert: vi.fn() },
    extractedField: { findMany: vi.fn(), count: vi.fn() },
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
import { logComplianceEvent } from "@/lib/ngo-compliance";
import { POST } from "@/app/api/admin/verify-ngo/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;
const logAdminActionMock = logAdminAction as any;
const logComplianceEventMock = logComplianceEvent as any;

function pendingNgo(overrides: Record<string, unknown> = {}) {
  return {
    id: "ngo_1",
    orgName: "Sahyog Foundation",
    verificationStatus: "PENDING",
    user: { email: "ngo@example.com" },
    // No open RiskReview = triage found the documents clean.
    riskReviews: [],
    // The front gate refuses to approve an organisation with no documents at
    // all — there would be nothing to approve on. Every fixture here is meant
    // to be approvable unless the test says otherwise, so it has one.
    documents: ["https://storage.test/registration.pdf"],
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
    // Default: extraction has run and every field was validated, so the
    // pre-existing approval/rejection tests are unaffected by the new gate.
    prismaMock.extractedField.findMany.mockResolvedValue([
      { fieldKey: "panNumber", status: "VALIDATED" },
      { fieldKey: "registrationNumber", status: "VALIDATED" },
      { fieldKey: "eightyGNumber", status: "VALIDATED" },
      { fieldKey: "a12Number", status: "VALIDATED" },
    ]);
    // The front gate counts fields before it will allow an approval.
    prismaMock.extractedField.count.mockResolvedValue(4);
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

  it("sets only the compliance flags backed by a VALIDATED extracted field", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());
    prismaMock.extractedField.findMany.mockResolvedValue([
      { fieldKey: "panNumber", status: "VALIDATED" },
      { fieldKey: "registrationNumber", status: "VALIDATED" },
      // Read clearly but never confirmed by a human.
      { fieldKey: "eightyGNumber", status: "EXTRACTED" },
    ]);

    await POST(approveRequest());

    const upsertArg = prismaMock.nGOCompliance.upsert.mock.calls[0][0];
    expect(upsertArg.update.panVerified).toBe(true);
    expect(upsertArg.update.registrationVerified).toBe(true);
    expect(upsertArg.update.eightyGVerified).toBeUndefined();
    expect(upsertArg.update.a12Verified).toBeUndefined();
  });

  it("refuses to approve an NGO whose documents have never been analysed", async () => {
    // This used to assert that approval SUCCEEDED and merely claimed no
    // compliance flags. That was the weaker guarantee, and it is what let three
    // organisations reach VERIFIED on no evidence: not claiming a flag is not
    // the same as not making the decision. The front gate now blocks it.
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());
    prismaMock.extractedField.count.mockResolvedValue(0);
    prismaMock.extractedField.findMany.mockResolvedValue([]);

    const res = await POST(approveRequest());

    expect(res.status).toBe(400);
    expect(prismaMock.nGOProfile.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.nGOCompliance.upsert).not.toHaveBeenCalled();
  });

  it("refuses to approve an NGO that has uploaded no documents at all", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo({ documents: [] }));
    prismaMock.extractedField.count.mockResolvedValue(0);

    const res = await POST(approveRequest("Looks fine to me."));

    // Not note-overridable: there is no evidence for a note to be about.
    expect(res.status).toBe(400);
    expect(prismaMock.nGOProfile.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to approve over an identity contradiction, even with a note", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(
      pendingNgo({
        riskReviews: [
          {
            riskLevel: "HIGH",
            findings: [
              { fieldKey: "panNumber", severity: "HIGH", issue: "PAN on document does not match the form" },
            ],
          },
        ],
      })
    );
    prismaMock.extractedField.count.mockResolvedValue(5);

    const res = await POST(approveRequest("I checked with them over the phone."));

    // A missing 80G is an everyday approval. A PAN that disagrees with the PAN
    // on the form is a question about who this organisation is, and a sentence
    // in a text box is not an answer to it.
    expect(res.status).toBe(400);
    expect(prismaMock.nGOProfile.updateMany).not.toHaveBeenCalled();
  });

  it("does not write a compliance audit entry for a flag it did not set", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());
    prismaMock.extractedField.findMany.mockResolvedValue([
      { fieldKey: "panNumber", status: "VALIDATED" },
    ]);

    await POST(approveRequest());

    const events = logComplianceEventMock.mock.calls.map((c: any[]) => c[1]);
    expect(events).toContain("PAN_VERIFIED");
    expect(events).not.toContain("80G_VERIFIED");
    expect(events).not.toContain("REGISTRATION_VERIFIED");
  });

  it("blocks approval with unreviewed fields unless the admin explains why", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(pendingNgo());
    prismaMock.extractedField.findMany.mockResolvedValue([
      { fieldKey: "panNumber", status: "NEEDS_REVIEW" },
    ]);

    const blocked = await POST(approveRequest());
    expect(blocked.status).toBe(400);
    expect(prismaMock.nGOProfile.updateMany).not.toHaveBeenCalled();

    // The gate is friction, not a hard block: a written reason lets it through.
    const allowed = await POST(approveRequest("PAN card is illegible; verified by phone with the registrar."));
    expect(allowed.status).toBe(200);
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

  it("requires a justification note to approve against a HIGH risk finding", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(
      pendingNgo({ riskReviews: [{ riskLevel: "HIGH", findings: [{ severity: "HIGH", issue: "PAN already registered to another organisation." }] }] })
    );

    const res = await POST(approveRequest());

    expect(res.status).toBe(400);
    expect(prismaMock.nGOProfile.updateMany).not.toHaveBeenCalled();
  });

  it("allows approval against a HIGH risk finding once a justification is given", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(
      pendingNgo({ riskReviews: [{ riskLevel: "HIGH", findings: [{ severity: "HIGH", issue: "PAN already registered to another organisation." }] }] })
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
