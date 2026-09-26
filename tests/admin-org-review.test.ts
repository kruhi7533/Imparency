import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/donor-events", () => ({ logDonorEvent: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { logDonorEvent } from "@/lib/donor-events";
import { POST } from "@/app/api/admin/donors/[id]/org-review/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;
const params = { params: { id: "donor_1" } };

/** Suryodaya Industries Limited, from the acceptance pack. */
function corporateDonor(overrides: Record<string, unknown> = {}) {
  return {
    id: "donor_1",
    role: "DONOR",
    isCorporate: true,
    companyName: "Suryodaya Industries Limited",
    cin: "U99999TG2026PLC000001",
    csrBudget: 5000000,
    donorPersona: "CSR_OFFICER",
    trustRegistrationId: null,
    trustAnnualBudget: null,
    orgVerificationStatus: "PENDING",
    ...overrides,
  };
}

function req(body: unknown) {
  return new Request("http://localhost/api/admin/donors/donor_1/org-review", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.notification.create.mockResolvedValue({});
});

describe("POST /api/admin/donors/[id]/org-review - access", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST(req({ action: "VERIFY", note: "checked MCA" }), params);
    expect(res.status).toBe(401);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a non-admin with 403 - an NGO cannot verify a funder", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });
    const res = await POST(req({ action: "VERIFY", note: "checked MCA" }), params);
    expect(res.status).toBe(403);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a donor trying to verify themselves with 403", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });
    const res = await POST(req({ action: "VERIFY", note: "I am legitimate" }), params);
    expect(res.status).toBe(403);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/donors/[id]/org-review - the human gate", () => {
  it("approves a complete profile, recording approver, timestamp and note", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor());

    const res = await POST(req({ action: "VERIFY", note: "CIN confirmed against MCA filings." }), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ orgVerificationStatus: "VERIFIED" });

    const write = prismaMock.user.updateMany.mock.calls[0][0];
    expect(write.data.orgVerificationStatus).toBe("VERIFIED");
    expect(write.data.orgVerifiedById).toBe("admin_1");
    expect(write.data.orgVerifiedAt).toBeInstanceOf(Date);
    expect(write.data.orgVerificationNote).toBe("CIN confirmed against MCA filings.");
  });

  it("writes the audit entry ADM-003 asks for", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor());
    await POST(req({ action: "VERIFY", note: "CIN confirmed." }), params);

    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: "admin_1",
        action: "CSR_ORG_VERIFIED",
        entityType: "DONOR",
        entityId: "donor_1",
        oldValue: { orgVerificationStatus: "PENDING" },
        newValue: { orgVerificationStatus: "VERIFIED" },
        note: "CIN confirmed.",
      })
    );
    expect(logDonorEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "CSR_ORG_VERIFIED", source: "ADMIN" })
    );
  });

  it("REFUSES to approve an incomplete profile and names what is missing", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor({ cin: null, csrBudget: null }));

    const res = await POST(req({ action: "VERIFY", note: "Looks fine to me." }), params);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.missing).toEqual(expect.arrayContaining(["CIN", "annual CSR budget"]));
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to approve a malformed CIN however confident the note is", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor({ cin: "NOTAREALCIN" }));

    const res = await POST(req({ action: "VERIFY", note: "I called them and they confirmed it." }), params);
    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("re-runs completeness against live data rather than trusting the PENDING status", async () => {
    // Status says PENDING, but the profile has been emptied since.
    prismaMock.user.findUnique.mockResolvedValue(
      corporateDonor({ orgVerificationStatus: "PENDING", companyName: null, cin: null, csrBudget: null })
    );
    const res = await POST(req({ action: "VERIFY", note: "approving" }), params);
    expect(res.status).toBe(400);
  });

  it("requires a written note on approval", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor());
    const res = await POST(req({ action: "VERIFY", note: "   " }), params);
    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("requires a written note on rejection - the donor is told this reason", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor());
    const res = await POST(req({ action: "REJECT" }), params);
    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an incomplete profile without complaint - only approval is gated", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor({ cin: null }));
    const res = await POST(req({ action: "REJECT", note: "No CIN supplied." }), params);
    expect(res.status).toBe(200);
    const write = prismaMock.user.updateMany.mock.calls[0][0];
    expect(write.data.orgVerificationStatus).toBe("REJECTED");
    expect(write.data.orgVerifiedAt).toBeNull();
  });

  it("approves a foundation on its trust registration, never a CIN", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      corporateDonor({
        donorPersona: "FOUNDATION",
        isCorporate: false,
        companyName: "Vaibhavi Charitable Foundation",
        cin: null,
        csrBudget: null,
        trustRegistrationId: "TRUST-TEST-2026-001",
        trustAnnualBudget: 2000000,
      })
    );
    const res = await POST(req({ action: "VERIFY", note: "Trust deed sighted." }), params);
    expect(res.status).toBe(200);
    expect(prismaMock.user.updateMany.mock.calls[0][0].data.orgVerificationStatus).toBe("VERIFIED");
  });

  it("refuses a foundation with no trust registration number", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      corporateDonor({
        donorPersona: "FOUNDATION",
        isCorporate: false,
        cin: null,
        csrBudget: null,
        trustRegistrationId: null,
        trustAnnualBudget: 2000000,
      })
    );
    const res = await POST(req({ action: "VERIFY", note: "looks fine" }), params);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      missing: expect.arrayContaining(["trust registration number"]),
    });
  });

  it("refuses an unknown action", async () => {
    const res = await POST(req({ action: "DELETE", note: "x" }), params);
    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/donors/[id]/org-review - state guard", () => {
  it("refuses to re-approve an already VERIFIED organisation", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor({ orgVerificationStatus: "VERIFIED" }));
    const res = await POST(req({ action: "VERIFY", note: "again" }), params);
    expect(res.status).toBe(409);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it("refuses to decide a donor who never submitted an organisation", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      corporateDonor({ orgVerificationStatus: "NOT_SUBMITTED", isCorporate: false, donorPersona: "INDIVIDUAL" })
    );
    const res = await POST(req({ action: "VERIFY", note: "sure" }), params);
    expect(res.status).toBe(409);
  });

  it("loses the race gracefully when another admin decided first", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor());
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(req({ action: "VERIFY", note: "CIN confirmed." }), params);
    expect(res.status).toBe(409);
    // No audit entry and no donor notification for a decision that did not land.
    expect(logAdminAction).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it("scopes the write with a compare-and-swap on PENDING", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor());
    await POST(req({ action: "VERIFY", note: "CIN confirmed." }), params);
    expect(prismaMock.user.updateMany.mock.calls[0][0].where).toEqual({
      id: "donor_1",
      orgVerificationStatus: "PENDING",
    });
  });

  it("404s on a user who is not a donor", async () => {
    prismaMock.user.findUnique.mockResolvedValue(corporateDonor({ role: "NGO" }));
    const res = await POST(req({ action: "VERIFY", note: "x" }), params);
    expect(res.status).toBe(404);
  });

  it("404s on a missing user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await POST(req({ action: "VERIFY", note: "x" }), params);
    expect(res.status).toBe(404);
  });
});
