import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    nGOCompliance: { findUnique: vi.fn() },
    donation: { create: vi.fn() },
  },
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })),
}));

// Razorpay must never be reached by a refused donation — if the order is
// created and then we 403, the donor has an open order for a payment we
// refused, which is worse than either outcome on its own.
const createOrder = vi.fn(async () => ({ id: "order_test_1" }));
vi.mock("razorpay", () => ({
  default: class {
    orders = { create: createOrder };
  },
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/donations/create-order/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;

function donorRow(overrides: Record<string, unknown> = {}) {
  return {
    donorCategory: "INDIAN_IN_INDIA",
    nriSourceDeclaration: null,
    donorPersona: "CSR_OFFICER",
    orgVerificationStatus: "VERIFIED",
    ...overrides,
  };
}

const req = (body: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/donations/create-order", {
    method: "POST",
    body: JSON.stringify({ projectId: "proj_1", amount: 250000, ...body }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });
  prismaMock.project.findUnique.mockResolvedValue({
    id: "proj_1",
    status: "ACTIVE",
    ngoId: "ngo_1",
    title: "After-School Learning Centres",
  });
  prismaMock.nGOCompliance.findUnique.mockResolvedValue({
    fcraStatus: "NONE",
    fcraExpiryDate: null,
  });
});

/**
 * The bypass this closes.
 *
 * Being NAMED as the funder behind an opportunity was gated on organisation
 * verification; actually PAYING was not. That is the wrong way round — the
 * payment is the part that moves money — and it meant the whole funding rail
 * could be walked around with the ordinary Donate button.
 */
describe("POST /api/donations/create-order — institutional donor gate", () => {
  it("REFUSES a CSR donor whose organisation was never verified", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      donorRow({ orgVerificationStatus: "NOT_SUBMITTED" })
    );
    const res = await POST(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("ORG_NOT_VERIFIED");
    // DonateModal renders `data.error` straight into the UI, so it must hold a
    // sentence a donor can read — never the machine code.
    expect(body.error).toMatch(/[a-z] [a-z]/);
    expect(body.error).not.toBe("ORG_NOT_VERIFIED");
  });

  it("refuses a CSR donor whose organisation is still pending", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donorRow({ orgVerificationStatus: "PENDING" }));
    const res = await POST(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("as soon as that is complete");
  });

  it("refuses a rejected organisation", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donorRow({ orgVerificationStatus: "REJECTED" }));
    expect((await POST(req())).status).toBe(403);
  });

  it("refuses a foundation and a government body on the same rule", async () => {
    for (const persona of ["FOUNDATION", "GOVERNMENT"]) {
      prismaMock.user.findUnique.mockResolvedValue(
        donorRow({ donorPersona: persona, orgVerificationStatus: "NOT_SUBMITTED" })
      );
      expect((await POST(req())).status).toBe(403);
    }
  });

  it("never opens a Razorpay order for a refused donation", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      donorRow({ orgVerificationStatus: "NOT_SUBMITTED" })
    );
    await POST(req());
    expect(createOrder).not.toHaveBeenCalled();
    expect(prismaMock.donation.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/donations/create-order — ordinary giving is untouched", () => {
  it("does NOT gate an individual donor — they have no organisation to verify", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      donorRow({ donorPersona: "INDIVIDUAL", orgVerificationStatus: "NOT_SUBMITTED" })
    );
    const res = await POST(req());
    expect(res.status).not.toBe(403);
  });

  it("does NOT gate an HNI donor", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      donorRow({ donorPersona: "HNI", orgVerificationStatus: "NOT_SUBMITTED" })
    );
    expect((await POST(req())).status).not.toBe(403);
  });

  it("does NOT gate a donor with no persona set at all", async () => {
    // The overwhelming majority of existing rows. Gating these would break
    // ordinary giving for everyone who never completed onboarding.
    prismaMock.user.findUnique.mockResolvedValue(
      donorRow({ donorPersona: null, orgVerificationStatus: "NOT_SUBMITTED" })
    );
    expect((await POST(req())).status).not.toBe(403);
  });

  it("lets a verified institution through", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donorRow());
    const res = await POST(req());
    expect(res.status).not.toBe(403);
  });
});
