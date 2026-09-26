import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findFirst: vi.fn() },
    fundingOpportunity: { findUnique: vi.fn() },
    matchCandidate: { findFirst: vi.fn() },
    proposal: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/ngo/proposals/route";

const db = prisma as any;
const session = getServerSession as any;

/**
 * What these tests protect.
 *
 * Submitting a proposal is the one place an organisation writes into the
 * funding pipeline, so two things must hold: being shortlisted is verified
 * server-side rather than claimed, and the shortlisting checked is the
 * CALLER'S OWN. `verifySessionRole("NGO")` proves the caller is an NGO, never
 * which NGO — the tenancy trap described in CLAUDE.md.
 */

function req(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/ngo/proposals", {
    method: "POST",
    body: JSON.stringify({
      opportunityId: "opp_1",
      title: "Clean water for 3 villages",
      summary: "Borewell repair and maintenance training.",
      requestedAmount: 250000,
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "user_1", role: "NGO" } });
  db.nGOProfile.findFirst.mockResolvedValue({ id: "ngo_1" });
  db.fundingOpportunity.findUnique.mockResolvedValue({ id: "opp_1", status: "OPEN" });
  db.matchCandidate.findFirst.mockResolvedValue({ id: "cand_1" });
  db.proposal.findUnique.mockResolvedValue(null);
  db.proposal.upsert.mockResolvedValue({ id: "prop_1", status: "SUBMITTED" });
});

describe("who may submit", () => {
  it("refuses an unauthenticated caller", async () => {
    session.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(db.proposal.upsert).not.toHaveBeenCalled();
  });

  it("refuses an admin — proposals come from organisations", async () => {
    session.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(db.proposal.upsert).not.toHaveBeenCalled();
  });

  it("refuses an NGO account with no organisation profile", async () => {
    db.nGOProfile.findFirst.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(db.proposal.upsert).not.toHaveBeenCalled();
  });
});

describe("tenant isolation", () => {
  it("checks the shortlisting of the caller's OWN organisation", async () => {
    // The whole point: role proves "an NGO", never "this NGO".
    await POST(req());
    const { where } = db.matchCandidate.findFirst.mock.calls[0][0];
    expect(where.ngoId).toBe("ngo_1");
    expect(where.decision).toBe("SHORTLISTED");
    expect(where.job).toEqual({ opportunityId: "opp_1" });
  });

  it("writes the proposal against the caller's own organisation", async () => {
    await POST(req());
    const args = db.proposal.upsert.mock.calls[0][0];
    expect(args.where.opportunityId_ngoId.ngoId).toBe("ngo_1");
    expect(args.create.ngoId).toBe("ngo_1");
  });

  it("refuses an organisation that was never shortlisted", async () => {
    db.matchCandidate.findFirst.mockResolvedValue(null);
    const res = await POST(req());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not been shortlisted/i);
    expect(db.proposal.upsert).not.toHaveBeenCalled();
  });
});

describe("preconditions", () => {
  it("404s an opportunity that does not exist", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(null);
    expect((await POST(req())).status).toBe(404);
    expect(db.proposal.upsert).not.toHaveBeenCalled();
  });

  it("refuses an opportunity that is not open", async () => {
    for (const status of ["DRAFT", "SUBMITTED", "CLOSED", "REJECTED"]) {
      db.fundingOpportunity.findUnique.mockResolvedValue({ id: "opp_1", status });
      expect((await POST(req())).status).toBe(409);
    }
    expect(db.proposal.upsert).not.toHaveBeenCalled();
  });

  it("requires a title, a summary and a positive amount", async () => {
    expect((await POST(req({ title: "  " }))).status).toBe(400);
    expect((await POST(req({ summary: "" }))).status).toBe(400);
    expect((await POST(req({ requestedAmount: 0 }))).status).toBe(400);
    expect((await POST(req({ requestedAmount: -5 }))).status).toBe(400);
    expect((await POST(req({ requestedAmount: "abc" }))).status).toBe(400);
    expect(db.proposal.upsert).not.toHaveBeenCalled();
  });
});

describe("resubmission", () => {
  it("edits the existing draft rather than forking a second proposal", async () => {
    db.proposal.findUnique.mockResolvedValue({ id: "prop_1", status: "SUBMITTED" });
    const res = await POST(req({ title: "Revised title" }));

    expect(res.status).toBe(200);
    expect(db.proposal.upsert).toHaveBeenCalledTimes(1);
    expect(db.proposal.upsert.mock.calls[0][0].update.title).toBe("Revised title");
  });

  it("refuses to overwrite a proposal that has already been decided", async () => {
    // Resubmitting over an approval would change what was approved.
    for (const status of ["APPROVED", "REJECTED", "UNDER_REVIEW", "WITHDRAWN"]) {
      db.proposal.findUnique.mockResolvedValue({ id: "prop_1", status });
      expect((await POST(req())).status).toBe(409);
    }
    expect(db.proposal.upsert).not.toHaveBeenCalled();
  });

  it("marks a first submission as submitted, with a timestamp", async () => {
    const res = await POST(req());
    expect(res.status).toBe(201);

    const { create } = db.proposal.upsert.mock.calls[0][0];
    expect(create.status).toBe("SUBMITTED");
    expect(create.submittedAt).toBeInstanceOf(Date);
  });
});
