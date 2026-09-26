import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    fundingOpportunity: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn(), requestMeta: vi.fn(() => ({})) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { PATCH } from "@/app/api/admin/matching/opportunities/[id]/route";

const db = prisma as any;
const session = getServerSession as any;

/**
 * What these tests protect.
 *
 * OPEN is the moment an opportunity becomes real: the engine starts matching
 * organisations against it, and an NGO can be emailed that a funder is
 * interested. Everything the platform vouches for flows from that one
 * transition, so the gate has to hold.
 *
 * The specific risk is an advance-fee scam wearing the platform's credibility:
 * NGOs are verified thoroughly, so a shortlist email from ImpactBridge carries
 * weight. If the money behind it is an unverified account — or just a name
 * somebody typed — that weight is unearned. Hence: no open without a linked,
 * institutional, PAN-verified donor.
 */

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp_1",
    status: "SUBMITTED",
    funderUserId: "funder_1",
    _count: { criteria: 3 },
    ...overrides,
  };
}

function funder(overrides: Record<string, unknown> = {}) {
  return {
    id: "funder_1",
    name: "Asha Foundation",
    email: "grants@asha.org",
    companyName: "Asha Foundation",
    role: "DONOR",
    donorPersona: "FOUNDATION",
    panStatus: "VERIFIED",
    ...overrides,
  };
}

const ctx = { params: { id: "opp_1" } };
const req = (body: Record<string, unknown>) =>
  new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.fundingOpportunity.findUnique.mockResolvedValue(opportunity());
  db.fundingOpportunity.updateMany.mockResolvedValue({ count: 1 });
  db.user.findUnique.mockResolvedValue(funder());
});

describe("who may move an opportunity", () => {
  it("refuses an unauthenticated caller", async () => {
    session.mockResolvedValue(null);
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(401);
    expect(db.fundingOpportunity.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a donor caller", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "DONOR" } });
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(403);
    expect(db.fundingOpportunity.updateMany).not.toHaveBeenCalled();
  });
});

describe("the money must come from a verified donor", () => {
  it("opens when the funder is a verified institutional donor", async () => {
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(200);
    expect(db.fundingOpportunity.updateMany).toHaveBeenCalledWith({
      where: { id: "opp_1", status: "SUBMITTED" },
      data: { status: "OPEN" },
    });
  });

  it("refuses to open with no funder account at all", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(opportunity({ funderUserId: null }));
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/verified funder account/i);
    expect(db.fundingOpportunity.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to open when the funder's PAN is unverified", async () => {
    db.user.findUnique.mockResolvedValue(funder({ panStatus: "UNVERIFIED" }));
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/not verified/i);
    expect(db.fundingOpportunity.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to open when PAN verification actually failed", async () => {
    db.user.findUnique.mockResolvedValue(funder({ panStatus: "FAILED" }));
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(400);
    expect(db.fundingOpportunity.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an individual donor — funding is an institutional act", async () => {
    db.user.findUnique.mockResolvedValue(funder({ donorPersona: "INDIVIDUAL" }));
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/individual donor/i);
  });

  it("refuses an account that is not a donor at all", async () => {
    db.user.findUnique.mockResolvedValue(funder({ role: "NGO" }));
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(400);
  });

  it("still refuses to open with no criteria, even with a good funder", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(
      opportunity({ _count: { criteria: 0 } })
    );
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(400);
    expect(db.fundingOpportunity.updateMany).not.toHaveBeenCalled();
  });
});

describe("the lifecycle", () => {
  it("rejects a submission, but only with a reason the donor can be told", async () => {
    const noReason = await PATCH(req({ action: "REJECT" }), ctx);
    expect(noReason.status).toBe(400);
    expect(db.fundingOpportunity.updateMany).not.toHaveBeenCalled();

    const withReason = await PATCH(req({ action: "REJECT", note: "Out of our stated focus areas." }), ctx);
    expect(withReason.status).toBe(200);
    expect(db.fundingOpportunity.updateMany).toHaveBeenCalledWith({
      where: { id: "opp_1", status: "SUBMITTED" },
      data: { status: "REJECTED" },
    });
  });

  it("refuses an illegal transition", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(opportunity({ status: "CLOSED" }));
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(409);
  });

  it("does not check the funder when merely closing", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(opportunity({ status: "OPEN" }));
    const res = await PATCH(req({ action: "CLOSE" }), ctx);
    expect(res.status).toBe(200);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("409s when another admin decided first", async () => {
    db.fundingOpportunity.updateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(req({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(409);
  });

  it("keeps accepting the old OPEN action so existing callers do not break", async () => {
    const res = await PATCH(req({ action: "OPEN" }), ctx);
    expect(res.status).toBe(200);
  });
});
