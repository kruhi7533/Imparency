import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Four-eyes on committing money (roadmap row 9). The admin who proposed an
 * allocation cannot approve it; another admin can; rejecting your own is
 * allowed; a single-admin pilot can switch the rule off explicitly.
 */

const db = vi.hoisted(() => ({
  allocation: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  ledgerEntry: { create: vi.fn() },
  adminActionLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { checkFourEyes, fourEyesEnabled } from "@/lib/four-eyes";
import { PATCH as decide } from "@/app/api/admin/allocations/[id]/route";

const dec = (v: string) => new Prisma.Decimal(v);
const params = { params: { id: "alloc_1" } };
const req = (body: unknown) => new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
const as = (id: string) => (getServerSession as any).mockResolvedValue({ user: { id, role: "ADMIN" } });

describe("checkFourEyes", () => {
  it("refuses the maker as checker, allows anyone else", () => {
    expect(checkFourEyes({ makerId: "a", checkerId: "a", what: "allocation" }, {})).toMatchObject({ ok: false, status: 403 });
    expect(checkFourEyes({ makerId: "a", checkerId: "b", what: "allocation" }, {})).toEqual({ ok: true });
  });

  it("is on by default and only an explicit FOUR_EYES=off turns it off", () => {
    expect(fourEyesEnabled({})).toBe(true);
    expect(fourEyesEnabled({ FOUR_EYES: "" })).toBe(true);
    expect(fourEyesEnabled({ FOUR_EYES: "OFF" })).toBe(false);
    expect(checkFourEyes({ makerId: "a", checkerId: "a", what: "x" }, { FOUR_EYES: "off" })).toEqual({ ok: true });
  });
});

describe("PATCH /api/admin/allocations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FOUR_EYES;
    db.allocation.findUnique.mockResolvedValue({
      id: "alloc_1",
      status: "PENDING",
      amount: dec("100000.00"),
      ngoId: "ngo_1",
      opportunityId: "opp_1",
      proposalId: "prop_1",
      proposedById: "admin_maker",
      proposal: { status: "APPROVED", requestedAmount: dec("100000.00"), opportunity: { amount: dec("500000.00") } },
    });
    db.allocation.findMany.mockResolvedValue([]);
    db.allocation.updateMany.mockResolvedValue({ count: 1 });
    db.ledgerEntry.create.mockResolvedValue({ id: "ledger_1" });
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
  });

  it("the proposer cannot approve their own allocation, and nothing is written", async () => {
    as("admin_maker");
    const res = await decide(req({ action: "APPROVE" }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/four-eyes/);
    expect(db.allocation.updateMany).not.toHaveBeenCalled();
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("a different admin can approve", async () => {
    as("admin_checker");
    expect((await decide(req({ action: "APPROVE" }), params)).status).toBe(200);
    expect(db.ledgerEntry.create).toHaveBeenCalled();
  });

  it("the proposer may still reject (withdraw) their own", async () => {
    as("admin_maker");
    expect((await decide(req({ action: "REJECT", note: "Budget line moved to Q4." }), params)).status).toBe(200);
  });
});
