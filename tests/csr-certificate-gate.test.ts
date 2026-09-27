import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    donation: { findMany: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })),
}));

// The PDF renderer is irrelevant to the gate and expensive to run; if it is
// ever reached in these tests that is itself the bug.
vi.mock("@react-pdf/renderer", () => ({
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: vi.fn(async () => Buffer.from("pdf")),
  Font: { register: vi.fn() },
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/donations/csr-certificate/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;

function donor(overrides: Record<string, unknown> = {}) {
  return {
    id: "donor_1",
    name: "Suryodaya CSR Manager",
    role: "DONOR",
    isCorporate: true,
    companyName: "Suryodaya Industries Limited",
    cin: "U99999TG2026PLC000001",
    gstNumber: null,
    orgVerificationStatus: "VERIFIED",
    ...overrides,
  };
}

const req = () => new Request("http://localhost/api/donations/csr-certificate?fy=2026-27");

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });
  // No donations — the gate under test runs BEFORE this, so a 404 here means
  // the request got past the gate, which is exactly what we want to detect.
  prismaMock.donation.findMany.mockResolvedValue([]);
});

/**
 * The certificate names a "Corporate Entity", states a CSR utilisation figure,
 * and signs itself "ImpactBridge Compliance — Authorized Verifier". It used to
 * be issued on `isCorporate` alone — a checkbox the donor ticks on their own
 * profile. These tests pin that it is no longer self-service.
 */
describe("GET /api/donations/csr-certificate — the organisation gate", () => {
  it("refuses a self-declared corporate whose organisation was never verified", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor({ orgVerificationStatus: "NOT_SUBMITTED" }));
    const res = await GET(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("verified organisation");
    // Never reached the donation aggregation, let alone the PDF.
    expect(prismaMock.donation.findMany).not.toHaveBeenCalled();
  });

  it("refuses while the organisation is still in the review queue", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor({ orgVerificationStatus: "PENDING" }));
    const res = await GET(req());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ orgVerificationStatus: "PENDING" });
  });

  it("refuses a rejected organisation", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor({ orgVerificationStatus: "REJECTED" }));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("tells a donor with nothing submitted what to actually do", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor({ orgVerificationStatus: "NOT_SUBMITTED" }));
    const body = await (await GET(req())).json();
    expect(body.error).toContain("CIN");
  });

  it("does not tell a donor to add details when they are already waiting on us", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor({ orgVerificationStatus: "PENDING" }));
    const body = await (await GET(req())).json();
    expect(body.error).not.toContain("Add your company name");
  });

  it("lets a verified organisation through to the donation lookup", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor());
    const res = await GET(req());
    // 404 = no donations for the FY, which means the gate passed.
    expect(res.status).toBe(404);
    expect(prismaMock.donation.findMany).toHaveBeenCalled();
  });
});

describe("GET /api/donations/csr-certificate — pre-existing guards still hold", () => {
  it("rejects an unauthenticated caller", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it("rejects a non-donor", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    expect((await GET(req())).status).toBe(403);
  });

  it("still rejects a non-corporate account before the organisation gate", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor({ isCorporate: false }));
    const res = await GET(req());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("corporate accounts"),
    });
  });

  it("requires the fy parameter", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor());
    const res = await GET(new Request("http://localhost/api/donations/csr-certificate"));
    expect(res.status).toBe(400);
  });
});
