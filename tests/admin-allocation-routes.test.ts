import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  default: {
    proposal: { findUnique: vi.fn() },
    allocation: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    allocationPayment: { create: vi.fn() },
    ledgerEntry: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { POST as propose } from "@/app/api/admin/allocations/route";
import { PATCH as decide } from "@/app/api/admin/allocations/[id]/route";
import { POST as confirmPayment } from "@/app/api/admin/allocations/[id]/payments/route";

const db = prisma as any;
const session = getServerSession as any;
const audit = logAdminAction as any;
const dec = (v: string) => new Prisma.Decimal(v);

/**
 * What these tests protect.
 *
 * Committing money is the most consequential action on the admin side, so the
 * failures worth pinning are the ones that would let it happen wrongly: a
 * caller who is not an admin, a plan nobody approved, a budget overdrawn by a
 * race, a commitment recorded without its entry on the money log, and an
 * approval applied twice.
 */

function req(body?: unknown) {
  return new Request("http://localhost/api/admin/allocations", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as any;
}

const approvedProposal = {
  id: "prop_1",
  status: "APPROVED",
  ngoId: "ngo_1",
  opportunityId: "opp_1",
  requestedAmount: dec("100000.00"),
  allocation: null,
  opportunity: { id: "opp_1", amount: dec("500000.00") },
};

const pendingAllocation = {
  id: "alloc_1",
  status: "PENDING",
  amount: dec("100000.00"),
  ngoId: "ngo_1",
  opportunityId: "opp_1",
  proposalId: "prop_1",
  proposal: {
    status: "APPROVED",
    requestedAmount: dec("100000.00"),
    opportunity: { amount: dec("500000.00") },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.proposal.findUnique.mockResolvedValue(approvedProposal);
  db.allocation.findMany.mockResolvedValue([]);
  db.allocation.create.mockResolvedValue({ id: "alloc_1" });
  db.allocation.findUnique.mockResolvedValue(pendingAllocation);
  db.allocation.updateMany.mockResolvedValue({ count: 1 });
  db.ledgerEntry.create.mockResolvedValue({ id: "ledger_1" });
  db.allocationPayment.create.mockResolvedValue({ id: "pay_1" });
  // Interactive transaction: run the callback against the same mock client.
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
});

describe("proposing an allocation", () => {
  it("refuses an unauthenticated caller and writes nothing", async () => {
    session.mockResolvedValue(null);
    const res = await propose(req({ proposalId: "prop_1", amount: "1000" }));
    expect(res.status).toBe(401);
    expect(db.allocation.create).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    session.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });
    const res = await propose(req({ proposalId: "prop_1", amount: "1000" }));
    expect(res.status).toBe(403);
    expect(db.allocation.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING allocation and audits it", async () => {
    const res = await propose(req({ proposalId: "prop_1", amount: "100000.00" }));

    expect(res.status).toBe(201);
    expect(db.allocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ proposalId: "prop_1", proposedById: "admin_1" }),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ALLOCATION_PROPOSED", entityType: "ALLOCATION" }),
    );
  });

  it("refuses to fund a proposal that was never approved", async () => {
    db.proposal.findUnique.mockResolvedValue({ ...approvedProposal, status: "UNDER_REVIEW" });

    const res = await propose(req({ proposalId: "prop_1", amount: "100000.00" }));

    expect(res.status).toBe(409);
    expect(db.allocation.create).not.toHaveBeenCalled();
  });

  it("refuses to overdraw the opportunity's budget", async () => {
    db.allocation.findMany.mockResolvedValue([{ status: "APPROVED", amount: dec("450000.00") }]);

    const res = await propose(req({ proposalId: "prop_1", amount: "100000.00" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.refusal).toBe("EXCEEDS_REMAINING_BUDGET");
    expect(db.allocation.create).not.toHaveBeenCalled();
  });

  it("treats a lost race on the unique proposal index as already allocated", async () => {
    // The check passed, but another admin's create landed first. The index is
    // what actually prevents double-funding.
    db.allocation.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await propose(req({ proposalId: "prop_1", amount: "100000.00" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ refusal: "ALREADY_ALLOCATED" });
  });

  it("does not route the amount through a float", async () => {
    db.proposal.findUnique.mockResolvedValue({
      ...approvedProposal,
      requestedAmount: dec("0.30"),
    });

    await propose(req({ proposalId: "prop_1", amount: "0.30" }));

    const written = db.allocation.create.mock.calls[0][0].data.amount;
    expect(written.toFixed(2)).toBe("0.30");
  });

  it("404s on a proposal that does not exist", async () => {
    db.proposal.findUnique.mockResolvedValue(null);
    const res = await propose(req({ proposalId: "nope", amount: "1000" }));
    expect(res.status).toBe(404);
  });
});

describe("deciding an allocation", () => {
  const params = { params: { id: "alloc_1" } };

  it("refuses a non-admin before reading anything", async () => {
    session.mockResolvedValue({ user: { id: "donor_1", role: "DONOR" } });
    const res = await decide(req({ action: "APPROVE" }), params);
    expect(res.status).toBe(403);
    expect(db.allocation.updateMany).not.toHaveBeenCalled();
  });

  it("commits the money and writes the ledger entry in one transaction", async () => {
    const res = await decide(req({ action: "APPROVE" }), params);

    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const entry = db.ledgerEntry.create.mock.calls[0][0].data;
    expect(entry.entryType).toBe("ALLOCATION_COMMITTED");
    expect(entry.idempotencyKey).toBe("ALLOCATION_COMMITTED:alloc_1");
    // A commitment is not cash, and must stay out of the per-project and
    // per-donor sums the reconciler takes.
    expect(entry.projectId).toBeUndefined();
    expect(entry.donorId).toBeUndefined();
    expect(entry.ngoId).toBe("ngo_1");
  });

  it("points the allocation at the entry it created", async () => {
    await decide(req({ action: "APPROVE" }), params);
    expect(db.allocation.update).toHaveBeenCalledWith({
      where: { id: "alloc_1" },
      data: { ledgerEntryId: "ledger_1" },
    });
  });

  it("re-checks the budget at approval, not just when proposed", async () => {
    // Another allocation consumed the budget in between. Both looked
    // affordable when they were drafted.
    db.allocation.findMany.mockResolvedValue([{ status: "APPROVED", amount: dec("450000.00") }]);

    const res = await decide(req({ action: "APPROVE" }), params);

    expect(res.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not count the allocation against its own budget", async () => {
    await decide(req({ action: "APPROVE" }), params);
    // The sibling query must exclude this row, or approving would always look
    // like double-spending its own amount.
    expect(db.allocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opportunityId: "opp_1", id: { not: "alloc_1" } } }),
    );
  });

  it("409s when another admin already decided it", async () => {
    db.$transaction.mockImplementation(async (fn: any) => {
      db.allocation.updateMany.mockResolvedValue({ count: 0 });
      return fn(db);
    });

    const res = await decide(req({ action: "APPROVE" }), params);

    expect(res.status).toBe(409);
  });

  it("treats a replayed approval as already applied, not as a failure", async () => {
    db.$transaction.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await decide(req({ action: "APPROVE" }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
  });

  it("refuses to approve an allocation that is already decided", async () => {
    db.allocation.findUnique.mockResolvedValue({ ...pendingAllocation, status: "APPROVED" });

    const res = await decide(req({ action: "APPROVE" }), params);

    expect(res.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("requires a reason to reject", async () => {
    const res = await decide(req({ action: "REJECT", note: "  " }), params);
    expect(res.status).toBe(400);
    expect(db.allocation.updateMany).not.toHaveBeenCalled();
  });

  it("records a rejection with its reason and writes no ledger entry", async () => {
    const res = await decide(req({ action: "REJECT", note: "Funder withdrew this round" }), params);

    expect(res.status).toBe(200);
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ALLOCATION_REJECTED",
        note: "Funder withdrew this round",
      }),
    );
  });

  it("rejects an unknown action rather than guessing", async () => {
    const res = await decide(req({ action: "UNDO" }), params);
    expect(res.status).toBe(400);
  });
});

describe("confirming that committed money arrived", () => {
  const params = { params: { id: "alloc_1" } };
  const approved = {
    id: "alloc_1",
    status: "APPROVED",
    amount: dec("100000.00"),
    ngoId: "ngo_1",
    proposalId: "prop_1",
    payments: [],
  };

  beforeEach(() => {
    db.allocation.findUnique.mockResolvedValue(approved);
  });

  it("refuses a non-admin", async () => {
    session.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });
    const res = await confirmPayment(req({ amount: "1000" }), params);
    expect(res.status).toBe(403);
    expect(db.allocationPayment.create).not.toHaveBeenCalled();
  });

  it("records the attestation with the admin who made it", async () => {
    // The attester is the whole value of the record. A confirmation with no
    // name behind it is an unsourced claim.
    const res = await confirmPayment(
      req({ amount: "100000.00", reference: "UTR12345", paidAt: "2026-09-28T00:00:00Z" }),
      params,
    );

    expect(res.status).toBe(201);
    const data = db.allocationPayment.create.mock.calls[0][0].data;
    expect(data.recordedById).toBe("admin_1");
    expect(data.reference).toBe("UTR12345");
    expect(data.amount.toFixed(2)).toBe("100000.00");
  });

  it("writes the confirmation to the money log as a non-cash entry", async () => {
    await confirmPayment(req({ amount: "100000.00", reference: "UTR1" }), params);

    const entry = db.ledgerEntry.create.mock.calls[0][0].data;
    expect(entry.entryType).toBe("ALLOCATION_FUNDED");
    expect(entry.direction).toBe("CREDIT");
    expect(entry.idempotencyKey).toBe("ALLOCATION_FUNDED:pay_1");
    // The platform did not receive this money — a funder paid the organisation
    // directly — so it must never land in a project or donor total.
    expect(entry.projectId).toBeUndefined();
    expect(entry.donorId).toBeUndefined();
  });

  it("writes the payment and its log entry in one transaction", async () => {
    await confirmPayment(req({ amount: "100000.00" }), params);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("records that a confirmation had no reference", async () => {
    // Without one there is nothing to match against a statement, and the
    // record is only somebody's word — worth knowing later.
    await confirmPayment(req({ amount: "100000.00" }), params);

    expect(db.allocationPayment.create.mock.calls[0][0].data.reference).toBeNull();
    expect(db.ledgerEntry.create.mock.calls[0][0].data.metadata.hasReference).toBe(false);
  });

  it("refuses to confirm more than was committed", async () => {
    db.allocation.findUnique.mockResolvedValue({
      ...approved,
      payments: [{ amount: dec("70000.00") }],
    });

    const res = await confirmPayment(req({ amount: "40000.00" }), params);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ refusal: "EXCEEDS_COMMITMENT" });
    expect(db.allocationPayment.create).not.toHaveBeenCalled();
  });

  it("refuses a confirmation against a commitment that is not approved", async () => {
    db.allocation.findUnique.mockResolvedValue({ ...approved, status: "PENDING" });

    const res = await confirmPayment(req({ amount: "1000" }), params);

    expect(res.status).toBe(409);
    expect(db.allocationPayment.create).not.toHaveBeenCalled();
  });

  it("refuses a transfer dated in the future", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const res = await confirmPayment(req({ amount: "1000", paidAt: tomorrow }), params);
    expect(res.status).toBe(400);
  });

  it("404s on an allocation that does not exist", async () => {
    db.allocation.findUnique.mockResolvedValue(null);
    const res = await confirmPayment(req({ amount: "1000" }), params);
    expect(res.status).toBe(404);
  });

  it("audits the confirmation", async () => {
    await confirmPayment(req({ amount: "100000.00", reference: "UTR1" }), params);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ALLOCATION_PAYMENT_RECORDED",
        entityType: "ALLOCATION",
        entityId: "alloc_1",
      }),
    );
  });
});
