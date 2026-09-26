import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: { proposal: { findUnique: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn(), requestMeta: vi.fn(() => ({})) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { PATCH } from "@/app/api/admin/proposals/[id]/route";

const db = prisma as any;
const session = getServerSession as any;
const audit = logAdminAction as any;

/**
 * What these tests protect.
 *
 * APPROVED is what a funded project gets built from, so it is the one status
 * that must never be reachable by accident: not from a status that skips
 * review, not by a second admin racing the first, and not without the decision
 * being attributable.
 */

function req(body: unknown) {
  return new Request("http://localhost/api/admin/proposals/p1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = { params: { id: "p1" } };

function proposal(overrides: Record<string, unknown> = {}) {
  return { id: "p1", status: "SUBMITTED", ngoId: "ngo_1", opportunityId: "opp_1", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.proposal.findUnique.mockResolvedValue(proposal());
  db.proposal.updateMany.mockResolvedValue({ count: 1 });
});

describe("who may decide a proposal", () => {
  it("refuses an unauthenticated caller and writes nothing", async () => {
    session.mockResolvedValue(null);
    const res = await PATCH(req({ action: "START_REVIEW" }), params);
    expect(res.status).toBe(401);
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an NGO caller — an organisation cannot approve its own proposal", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await PATCH(req({ action: "APPROVE" }), params);
    expect(res.status).toBe(403);
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a DONOR caller", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "DONOR" } });
    const res = await PATCH(req({ action: "APPROVE" }), params);
    expect(res.status).toBe(403);
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });
});

describe("the legal moves", () => {
  it("takes a submitted proposal up for review", async () => {
    const res = await PATCH(req({ action: "START_REVIEW" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "p1", status: "UNDER_REVIEW" });

    const { data } = db.proposal.updateMany.mock.calls[0][0];
    expect(data.status).toBe("UNDER_REVIEW");
    expect(data.reviewerId).toBe("admin_1");
    // Taking something up is not deciding it.
    expect(data.decidedById).toBeUndefined();
  });

  it("approves a proposal that is under review", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal({ status: "UNDER_REVIEW" }));
    const res = await PATCH(req({ action: "APPROVE" }), params);

    expect(res.status).toBe(200);
    const { data } = db.proposal.updateMany.mock.calls[0][0];
    expect(data.status).toBe("APPROVED");
    expect(data.decidedById).toBe("admin_1");
    expect(data.decidedAt).toBeInstanceOf(Date);
  });

  it("refuses to approve something nobody has reviewed", async () => {
    // Otherwise "under review" is a step that can be skipped, and approval
    // stops meaning a human looked.
    const res = await PATCH(req({ action: "APPROVE" }), params); // still SUBMITTED
    expect(res.status).toBe(409);
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to move a proposal that is already decided", async () => {
    for (const status of ["APPROVED", "REJECTED", "WITHDRAWN"]) {
      db.proposal.findUnique.mockResolvedValue(proposal({ status }));
      const res = await PATCH(req({ action: "APPROVE" }), params);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain(status.toLowerCase());
    }
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown action rather than guessing", async () => {
    for (const action of ["DELETE", "approve", "", null, 42]) {
      const res = await PATCH(req({ action }), params);
      expect(res.status).toBe(400);
    }
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("404s a proposal that does not exist", async () => {
    db.proposal.findUnique.mockResolvedValue(null);
    const res = await PATCH(req({ action: "START_REVIEW" }), params);
    expect(res.status).toBe(404);
  });
});

describe("a rejection must say why", () => {
  it("refuses a rejection with no reason", async () => {
    // The organisation is told this; "no" with no reason cannot be acted on.
    db.proposal.findUnique.mockResolvedValue(proposal({ status: "UNDER_REVIEW" }));
    for (const note of [undefined, "", "   "]) {
      const res = await PATCH(req({ action: "REJECT", note }), params);
      expect(res.status).toBe(400);
    }
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("stores the reason verbatim", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal({ status: "UNDER_REVIEW" }));
    const res = await PATCH(req({ action: "REJECT", note: "Budget exceeds the ceiling." }), params);

    expect(res.status).toBe(200);
    const { data } = db.proposal.updateMany.mock.calls[0][0];
    expect(data.status).toBe("REJECTED");
    expect(data.decisionNote).toBe("Budget exceeds the ceiling.");
  });

  it("does not demand a reason to approve", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal({ status: "UNDER_REVIEW" }));
    const res = await PATCH(req({ action: "APPROVE" }), params);
    expect(res.status).toBe(200);
  });
});

describe("two admins at once", () => {
  it("gives the loser a 409 rather than silently overwriting the decision", async () => {
    // The compare-and-swap matched nothing: somebody else moved it first.
    db.proposal.updateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(req({ action: "START_REVIEW" }), params);

    expect(res.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it("guards the transition on the status it started from", async () => {
    await PATCH(req({ action: "START_REVIEW" }), params);
    const { where } = db.proposal.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "p1", status: "SUBMITTED" });
  });
});

describe("attribution", () => {
  it("records every decision against the admin who took it", async () => {
    db.proposal.findUnique.mockResolvedValue(proposal({ status: "UNDER_REVIEW" }));
    await PATCH(req({ action: "APPROVE" }), params);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: "admin_1",
        action: "PROPOSAL_APPROVED",
        entityType: "PROPOSAL",
        entityId: "p1",
        oldValue: { status: "UNDER_REVIEW" },
        newValue: { status: "APPROVED" },
      })
    );
  });
});
