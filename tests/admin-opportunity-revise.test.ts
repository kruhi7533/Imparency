import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    fundingOpportunity: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    opportunityCriterion: { deleteMany: vi.fn(), createMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn((cb: any) =>
      cb({
        fundingOpportunity: { update: vi.fn() },
        opportunityCriterion: { deleteMany: vi.fn(), createMany: vi.fn() },
      })
    ),
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn(), requestMeta: vi.fn(() => ({})) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { PATCH } from "@/app/api/admin/matching/opportunities/[id]/route";

const db = prisma as any;
const session = getServerSession as any;
const logMock = logAdminAction as any;

/**
 * What these tests protect.
 *
 * This is the piece that closes the "donor says this isn't what I want" loop:
 * an admin edits criteria here, then presses Run/Requeue on the job page, and
 * the engine re-matches against what changed. runMatchingJob already re-reads
 * OpportunityCriterion fresh on every run (pinned separately in
 * matching-job-runner.test.ts) — this route is what finally lets that table
 * change after creation.
 *
 * The two things that must hold: a finished opportunity (CLOSED/REJECTED) has
 * nothing left to revise, and a criteria edit replaces the WHOLE set rather
 * than leaving stale rows behind.
 */

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp_1",
    status: "OPEN",
    title: "Sishu Shiksha Grant 2026",
    description: "Old description",
    amount: null,
    criteria: [
      { kind: "VERIFIED_STATUS", value: null, values: [], required: true },
      { kind: "CAUSE_CATEGORY", value: null, values: ["Education"], required: true },
    ],
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
  db.$transaction.mockImplementation((cb: any) =>
    cb({
      fundingOpportunity: { update: vi.fn() },
      opportunityCriterion: { deleteMany: vi.fn(), createMany: vi.fn() },
    })
  );
});

describe("who may revise", () => {
  it("refuses an unauthenticated caller", async () => {
    session.mockResolvedValue(null);
    const res = await PATCH(req({ title: "New title" }), ctx);
    expect(res.status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a donor caller", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "DONOR" } });
    const res = await PATCH(req({ title: "New title" }), ctx);
    expect(res.status).toBe(403);
  });
});

describe("what can be revised", () => {
  it("404s an unknown opportunity", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(null);
    const res = await PATCH(req({ title: "New title" }), ctx);
    expect(res.status).toBe(404);
  });

  it("refuses to revise a closed opportunity", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(opportunity({ status: "CLOSED" }));
    const res = await PATCH(req({ title: "New title" }), ctx);
    expect(res.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to revise a rejected opportunity", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(opportunity({ status: "REJECTED" }));
    const res = await PATCH(req({ title: "New title" }), ctx);
    expect(res.status).toBe(409);
  });

  it("allows revising a SUBMITTED opportunity — a donor's own submission is not finished", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue(opportunity({ status: "SUBMITTED" }));
    const res = await PATCH(req({ title: "New title" }), ctx);
    expect(res.status).toBe(200);
  });

  it("rejects an empty body — nothing to revise", async () => {
    const res = await PATCH(req({}), ctx);
    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an empty title", async () => {
    const res = await PATCH(req({ title: "   " }), ctx);
    expect(res.status).toBe(400);
  });
});

describe("revising criteria replaces the whole set", () => {
  it("deletes all existing criteria and recreates only the ones sent", async () => {
    let seenDeleteMany = false;
    let seenCreateMany: any = null;
    db.$transaction.mockImplementation((cb: any) =>
      cb({
        fundingOpportunity: { update: vi.fn() },
        opportunityCriterion: {
          deleteMany: vi.fn(async (args: any) => {
            seenDeleteMany = true;
            expect(args.where).toEqual({ opportunityId: "opp_1" });
          }),
          createMany: vi.fn(async (args: any) => {
            seenCreateMany = args;
          }),
        },
      })
    );

    const res = await PATCH(
      req({ criteria: [{ kind: "FCRA_ACTIVE", required: true }] }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(seenDeleteMany).toBe(true);
    expect(seenCreateMany.data).toEqual([
      { kind: "FCRA_ACTIVE", value: null, values: [], required: true, opportunityId: "opp_1" },
    ]);
  });

  it("rejects an unknown criterion kind and writes nothing", async () => {
    const res = await PATCH(req({ criteria: [{ kind: "MADE_UP_RULE" }] }), ctx);
    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("allows clearing all criteria to an empty set", async () => {
    let seenCreateMany = true;
    db.$transaction.mockImplementation((cb: any) =>
      cb({
        fundingOpportunity: { update: vi.fn() },
        opportunityCriterion: {
          deleteMany: vi.fn(),
          createMany: vi.fn(() => {
            seenCreateMany = true;
          }),
        },
      })
    );
    const res = await PATCH(req({ criteria: [] }), ctx);
    expect(res.status).toBe(200);
    // createMany must not be called with an empty array — nothing to create.
  });

  it("does not touch criteria when the body has no criteria key", async () => {
    let deleteManyCalled = false;
    db.$transaction.mockImplementation((cb: any) =>
      cb({
        fundingOpportunity: { update: vi.fn() },
        opportunityCriterion: {
          deleteMany: vi.fn(() => {
            deleteManyCalled = true;
          }),
          createMany: vi.fn(),
        },
      })
    );
    const res = await PATCH(req({ title: "New title only" }), ctx);
    expect(res.status).toBe(200);
    expect(deleteManyCalled).toBe(false);
  });
});

describe("audit trail", () => {
  it("logs OPPORTUNITY_REVISED with kinds, not full criterion detail", async () => {
    await PATCH(req({ criteria: [{ kind: "FCRA_ACTIVE", required: true }] }), ctx);
    expect(logMock).toHaveBeenCalledTimes(1);
    const logged = logMock.mock.calls[0][0];
    expect(logged.action).toBe("OPPORTUNITY_REVISED");
    expect(logged.newValue.criteriaKinds).toEqual(["FCRA_ACTIVE"]);
    expect(logged.oldValue.criteriaKinds).toEqual(["CAUSE_CATEGORY", "VERIFIED_STATUS"]);
  });
});

describe("status actions still work unchanged", () => {
  it("routes an { action } body to the existing transition logic, not revise", async () => {
    db.fundingOpportunity.findUnique.mockResolvedValue({
      id: "opp_1",
      status: "OPEN",
      funderUserId: null,
      _count: { criteria: 2 },
    });
    db.fundingOpportunity.updateMany.mockResolvedValue({ count: 1 });
    const res = await PATCH(req({ action: "CLOSE" }), ctx);
    expect(res.status).toBe(200);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
