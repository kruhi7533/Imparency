import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Workstream D (ADM-011 / E2E-004 / NGO-008 / DON-011 / DON-010 / NEG-006 /
 * ADM-008 / DON-012): contract payment → milestone allocation and funding.
 *
 * Golden path from the acceptance pack: a ₹22,50,000 contract with milestones
 * ₹4L / ₹8L / ₹8L / ₹2.5L, paid ₹10L then ₹12.5L with no milestone chosen.
 */

const db = vi.hoisted(() => ({
  contract: { findUnique: vi.fn() },
}));
const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ default: db }));
// The shared donor dispatcher owns preference handling; pinned here is that
// milestone events go THROUGH it, with the right recipient, topic and key.
vi.mock("@/lib/notification-dispatch", () => ({ dispatchDonorNotification: dispatch }));

import {
  checkManualAllocation,
  computeMilestoneFunding,
  countingLines,
  milestoneFundingStatus,
  notifyDonorMilestone,
  planAutoAllocation,
  recalcContractFunding,
  unallocatedByPayment,
} from "@/lib/contract-funding";
import { fundingSummary } from "@/lib/contract-payments";

const D = (v: string | number) => new Prisma.Decimal(v);
const MILESTONES = [
  { id: "m1", title: "Baseline", allocatedAmount: D("400000"), orderIndex: 0, createdAt: new Date("2026-01-01") },
  { id: "m2", title: "Build", allocatedAmount: D("800000"), orderIndex: 1, createdAt: new Date("2026-01-01") },
  { id: "m3", title: "Train", allocatedAmount: D("800000"), orderIndex: 2, createdAt: new Date("2026-01-01") },
  { id: "m4", title: "Report", allocatedAmount: D("250000"), orderIndex: 3, createdAt: new Date("2026-01-01") },
];
const asStrings = (lines: Array<{ contractMilestoneId: string; amount: Prisma.Decimal }>) =>
  lines.map((l) => [l.contractMilestoneId, l.amount.toFixed(2)]);

describe("planAutoAllocation — the documented milestone-order rule", () => {
  it("golden path: ₹10L then ₹12.5L fill milestones in delivery order", () => {
    const first = planAutoAllocation(MILESTONES, [], "1000000");
    expect(asStrings(first.lines)).toEqual([["m1", "400000.00"], ["m2", "600000.00"]]);
    expect(first.unallocated.toFixed(2)).toBe("0.00");

    const existing = first.lines.map((l) => ({ paymentId: "p1", ...l, status: "PENDING_APPROVAL" }));
    const second = planAutoAllocation(MILESTONES, existing, "1250000");
    expect(asStrings(second.lines)).toEqual([["m2", "200000.00"], ["m3", "800000.00"], ["m4", "250000.00"]]);
    expect(second.unallocated.toFixed(2)).toBe("0.00");
  });

  it("orders by orderIndex, not by array order", () => {
    const shuffled = [MILESTONES[2], MILESTONES[0], MILESTONES[3], MILESTONES[1]];
    expect(asStrings(planAutoAllocation(shuffled, [], "500000").lines)).toEqual([["m1", "400000.00"], ["m2", "100000.00"]]);
  });

  it("skips milestones an explicit payment already filled", () => {
    const explicit = [{ paymentId: "px", contractMilestoneId: "m1", amount: D("400000"), status: "PENDING_APPROVAL" }];
    expect(asStrings(planAutoAllocation(MILESTONES, explicit, "100000").lines)).toEqual([["m2", "100000.00"]]);
  });

  it("money beyond every milestone stays un-allocated rather than being forced on one", () => {
    const r = planAutoAllocation([{ id: "a", allocatedAmount: D("100"), orderIndex: 0 }], [], "150.50");
    expect(asStrings(r.lines)).toEqual([["a", "100.00"]]);
    expect(r.unallocated.toFixed(2)).toBe("50.50");
  });

  it("is Decimal-exact (no float drift on paise)", () => {
    const r = planAutoAllocation([{ id: "a", allocatedAmount: D("0.30"), orderIndex: 0 }, { id: "b", allocatedAmount: D("1"), orderIndex: 1 }], [], "0.30");
    expect(asStrings(r.lines)).toEqual([["a", "0.30"]]);
  });
});

describe("milestone funding — reconciled money only, separate from payment status", () => {
  const lines = [
    { paymentId: "p1", contractMilestoneId: "m1", amount: D("400000"), status: "APPROVED" },
    { paymentId: "p1", contractMilestoneId: "m2", amount: D("600000"), status: "PENDING_APPROVAL" },
    { paymentId: "p2", contractMilestoneId: "m2", amount: D("200000"), status: "PENDING_APPROVAL" },
    { paymentId: "p2", contractMilestoneId: "m3", amount: D("800000"), status: "PENDING_APPROVAL" },
  ];

  it("a pending payment never funds a milestone", () => {
    const f = computeMilestoneFunding(MILESTONES, [{ id: "p1", amount: D("1000000"), status: "PENDING_CONFIRMATION" }], lines.slice(0, 2));
    expect(f.map((m) => m.fundingStatus)).toEqual(["UNFUNDED", "UNFUNDED", "UNFUNDED", "UNFUNDED"]);
    expect(f[0].pending).toBe("400000.00");
  });

  it("UNFUNDED → PARTIALLY_FUNDED → FUNDED as payments reconcile", () => {
    const payments = [
      { id: "p1", amount: D("1000000"), status: "RECONCILED" },
      { id: "p2", amount: D("1000000"), status: "PENDING_CONFIRMATION" },
    ];
    const f = computeMilestoneFunding(MILESTONES, payments, lines);
    expect(f.map((m) => m.fundingStatus)).toEqual(["FUNDED", "PARTIALLY_FUNDED", "UNFUNDED", "UNFUNDED"]);
    expect(f[1]).toMatchObject({ committed: "800000.00", reconciled: "600000.00", pending: "200000.00", outstanding: "200000.00" });
    // Allocated = admin-approved lines on reconciled money.
    expect(f[0].allocated).toBe("400000.00");
    expect(f[1].allocated).toBe("0.00");
  });

  it("a rejected line and a disputed payment stop counting", () => {
    const payments = [
      { id: "p1", amount: D("1000000"), status: "RECONCILED" },
      { id: "p2", amount: D("1000000"), status: "DISPUTED" },
    ];
    const withRejection = lines.map((l, i) => (i === 1 ? { ...l, status: "REJECTED" } : l));
    const f = computeMilestoneFunding(MILESTONES, payments, withRejection);
    expect(f.map((m) => m.fundingStatus)).toEqual(["FUNDED", "UNFUNDED", "UNFUNDED", "UNFUNDED"]);
    expect(countingLines(withRejection, payments)).toHaveLength(1);
    expect(unallocatedByPayment(payments, withRejection).get("p1")!.toFixed(2)).toBe("600000.00");
  });

  it("milestoneFundingStatus boundaries", () => {
    expect(milestoneFundingStatus("100", "0")).toBe("UNFUNDED");
    expect(milestoneFundingStatus("100", "99.99")).toBe("PARTIALLY_FUNDED");
    expect(milestoneFundingStatus("100", "100")).toBe("FUNDED");
  });

  it("fundingSummary exposes committed / pending / reconciled / allocated per milestone (donor + NGO views)", () => {
    const s = fundingSummary(
      { totalGrantAmount: D("2250000") },
      MILESTONES,
      [
        { id: "p1", amount: D("1000000"), status: "RECONCILED", contractMilestoneId: null },
        { id: "p2", amount: D("1250000"), status: "RECONCILED", contractMilestoneId: null },
      ],
      [
        ...lines,
        { paymentId: "p2", contractMilestoneId: "m4", amount: D("250000"), status: "PENDING_APPROVAL" },
      ],
    );
    expect(s.state).toBe("FUNDED");
    expect(s.milestones.map((m) => m.fundingStatus)).toEqual(["FUNDED", "FUNDED", "FUNDED", "FUNDED"]);
    expect(s.milestones[0]).toMatchObject({ allocated: "400000.00", reconciled: "400000.00", pending: "0.00", approved: "400000.00" });
    expect(s.unallocated).toBe("0.00");
  });
});

describe("checkManualAllocation — allocation-level over-allocation is 422", () => {
  const payment = { id: "p1", amount: D("1000000"), status: "RECONCILED", contractId: "c1" };
  const payments = [payment];
  const m2 = { id: "m2", contractId: "c1", allocatedAmount: D("800000") };
  const lines = [{ paymentId: "p1", contractMilestoneId: "m1", amount: D("400000"), status: "APPROVED" }];

  it("refuses more than the payment has un-allocated", () => {
    const r = checkManualAllocation({ payment, milestone: { ...m2, allocatedAmount: D("2000000") }, lines, payments, amount: "600000.01" });
    expect(r).toMatchObject({ ok: false, status: 422 });
  });

  it("refuses more than the milestone has room for", () => {
    const busy = [...lines, { paymentId: "p9", contractMilestoneId: "m2", amount: D("500000"), status: "PENDING_APPROVAL" }];
    const r = checkManualAllocation({ payment, milestone: m2, lines: busy, payments: [...payments, { id: "p9", amount: D("500000"), status: "PENDING_CONFIRMATION" }], amount: "300000.01" });
    expect(r).toMatchObject({ ok: false, status: 422 });
  });

  it("accepts an exact fit, refuses another contract's milestone and a disputed payment", () => {
    expect(checkManualAllocation({ payment, milestone: m2, lines, payments, amount: "600000" }).ok).toBe(true);
    expect(checkManualAllocation({ payment, milestone: { ...m2, contractId: "c2" }, lines, payments, amount: "1" })).toMatchObject({ status: 400 });
    expect(checkManualAllocation({ payment: { ...payment, status: "DISPUTED" }, milestone: m2, lines, payments, amount: "1" })).toMatchObject({ status: 409 });
    expect(checkManualAllocation({ payment, milestone: m2, lines, payments, amount: "1.001" })).toMatchObject({ status: 400 });
  });
});

// ─── recalcContractFunding against an in-memory transaction ─────────────────

function fakeTx(state: {
  payments: Array<{ id: string; amount: Prisma.Decimal; status: string; recordedAt: Date; contractMilestoneId: string | null }>;
  lines: Array<{ paymentId: string; contractMilestoneId: string; amount: Prisma.Decimal; status: string }>;
}) {
  const milestones = MILESTONES.map((m) => ({ ...m, fundingStatus: "UNFUNDED" as string, fundedAt: null as Date | null }));
  const contract = { id: "c1", projectId: "proj1", totalGrantAmount: D("2250000"), fundedAt: null as Date | null };
  const project = { fundedAt: null as Date | null };
  const tx: any = {
    $queryRaw: vi.fn(),
    contract: {
      findUnique: vi.fn(async () => ({ ...contract, milestones: milestones.map((m) => ({ ...m })), payments: state.payments, paymentAllocations: [...state.lines] })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.fundedAt === null && contract.fundedAt) return { count: 0 };
        contract.fundedAt = data.fundedAt;
        return { count: 1 };
      }),
      findMany: vi.fn(async () => [{ status: "ACTIVE", totalGrantAmount: contract.totalGrantAmount, payments: state.payments }]),
    },
    contractPaymentAllocation: {
      createMany: vi.fn(async ({ data }: any) => {
        for (const d of data) state.lines.push({ ...d, status: "PENDING_APPROVAL" });
        return { count: data.length };
      }),
    },
    contractMilestone: {
      update: vi.fn(async ({ where, data }: any) => Object.assign(milestones.find((m) => m.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const m = milestones.find((x) => x.id === where.id)!;
        if (m.fundedAt) return { count: 0 };
        m.fundedAt = data.fundedAt;
        return { count: 1 };
      }),
    },
    contractAuditLog: { create: vi.fn() },
    project: {
      updateMany: vi.fn(async () => {
        if (project.fundedAt) return { count: 0 };
        project.fundedAt = new Date();
        return { count: 1 };
      }),
    },
  };
  return { tx, milestones, contract, project };
}

describe("recalcContractFunding — E2E-004 golden path", () => {
  it("pending money moves nothing; reconciliation funds milestones, then the contract and project, exactly once", async () => {
    const state = {
      payments: [
        { id: "p1", amount: D("1000000"), status: "PENDING_CONFIRMATION", recordedAt: new Date("2026-10-01"), contractMilestoneId: null },
      ],
      lines: [
        { paymentId: "p1", contractMilestoneId: "m1", amount: D("400000"), status: "PENDING_APPROVAL" },
        { paymentId: "p1", contractMilestoneId: "m2", amount: D("600000"), status: "PENDING_APPROVAL" },
      ],
    };
    const { tx, milestones, contract, project } = fakeTx(state);

    let out = await recalcContractFunding(tx, "c1");
    expect(milestones.map((m) => m.fundingStatus)).toEqual(["UNFUNDED", "UNFUNDED", "UNFUNDED", "UNFUNDED"]);
    expect(out.newlyFundedMilestones).toEqual([]);
    expect(tx.$queryRaw).toHaveBeenCalled(); // contract row lock

    state.payments[0].status = "RECONCILED";
    out = await recalcContractFunding(tx, "c1");
    expect(milestones.map((m) => m.fundingStatus)).toEqual(["FUNDED", "PARTIALLY_FUNDED", "UNFUNDED", "UNFUNDED"]);
    expect(out.newlyFundedMilestones.map((m) => m.id)).toEqual(["m1"]);
    expect(contract.fundedAt).toBeNull();

    state.payments.push({ id: "p2", amount: D("1250000"), status: "RECONCILED", recordedAt: new Date("2026-10-02"), contractMilestoneId: null });
    state.lines.push(
      { paymentId: "p2", contractMilestoneId: "m2", amount: D("200000"), status: "PENDING_APPROVAL" },
      { paymentId: "p2", contractMilestoneId: "m3", amount: D("800000"), status: "PENDING_APPROVAL" },
      { paymentId: "p2", contractMilestoneId: "m4", amount: D("250000"), status: "PENDING_APPROVAL" },
    );
    out = await recalcContractFunding(tx, "c1");
    expect(milestones.map((m) => m.fundingStatus)).toEqual(["FUNDED", "FUNDED", "FUNDED", "FUNDED"]);
    expect(out.newlyFundedMilestones.map((m) => m.id)).toEqual(["m2", "m3", "m4"]);
    expect(out.contractNewlyFunded).toBe(true);
    expect(out.projectNewlyFunded).toBe(true);
    expect(contract.fundedAt).toBeInstanceOf(Date);
    expect(project.fundedAt).toBeInstanceOf(Date);

    // Replay (a retried request, the admin sweep): no second stamp, no second notification.
    out = await recalcContractFunding(tx, "c1");
    expect(out).toEqual({ newlyFundedMilestones: [], contractNewlyFunded: false, projectNewlyFunded: false });
  });

  it("backfills legacy payments that have no allocation lines (the tester's already-reconciled contract)", async () => {
    const state = {
      payments: [
        { id: "p1", amount: D("1000000"), status: "RECONCILED", recordedAt: new Date("2026-10-01"), contractMilestoneId: null },
        { id: "p2", amount: D("1250000"), status: "RECONCILED", recordedAt: new Date("2026-10-02"), contractMilestoneId: null },
      ],
      lines: [] as any[],
    };
    const { tx, milestones, contract } = fakeTx(state);
    const out = await recalcContractFunding(tx, "c1");
    expect(state.lines.map((l) => [l.paymentId, l.contractMilestoneId, l.amount.toFixed(2)])).toEqual([
      ["p1", "m1", "400000.00"],
      ["p1", "m2", "600000.00"],
      ["p2", "m2", "200000.00"],
      ["p2", "m3", "800000.00"],
      ["p2", "m4", "250000.00"],
    ]);
    expect(milestones.every((m) => m.fundingStatus === "FUNDED")).toBe(true);
    expect(out.contractNewlyFunded).toBe(true);
    expect(contract.fundedAt).not.toBeNull();
    // Backfill runs once: the next recalculation finds the lines and adds none.
    await recalcContractFunding(tx, "c1");
    expect(state.lines).toHaveLength(5);
  });
});

describe("DON-012 — donor milestone notification goes through the preference-aware dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.contract.findUnique.mockResolvedValue({ donorId: "donor-1", projectId: "proj1", contractNumber: "CTR-1", project: { title: "Classrooms" } });
  });
  const ms = [{ id: "m1", title: "Baseline" }];

  it("funded: one dispatch to the contract's donor, PROJECT_UPDATE topic, idempotent event key", async () => {
    dispatch.mockResolvedValue([{ channel: "IN_APP", status: "SENT" }]);
    expect(await notifyDonorMilestone({ contractId: "c1", milestones: ms, event: "FUNDED" })).toBe(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "donor-1",
        topic: "PROJECT_UPDATE",
        eventKey: "contract-milestone-funded:m1",
        title: "Milestone fully funded",
        link: "/donor/contracts/c1",
      }),
    );
  });

  it("a donor who opted out is not counted as reached (dispatcher reports OPTED_OUT)", async () => {
    dispatch.mockResolvedValue([
      { channel: "IN_APP", status: "OPTED_OUT" },
      { channel: "WHATSAPP", status: "OPTED_OUT" },
      { channel: "EMAIL", status: "OPTED_OUT" },
    ]);
    expect(await notifyDonorMilestone({ contractId: "c1", milestones: ms, event: "FUNDED" })).toBe(0);
  });

  it("completed: its own event key, so funded and completed are separate events", async () => {
    dispatch.mockResolvedValue([{ channel: "IN_APP", status: "SENT" }]);
    await notifyDonorMilestone({ contractId: "c1", milestones: ms, event: "COMPLETED" });
    expect(dispatch.mock.calls[0][0]).toMatchObject({ eventKey: "contract-milestone-completed:m1", title: "Milestone completed" });
  });

  it("nothing to say → no dispatch; a failure never throws into the money path", async () => {
    expect(await notifyDonorMilestone({ contractId: "c1", milestones: [], event: "FUNDED" })).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRejectedValue(new Error("db down"));
    await expect(notifyDonorMilestone({ contractId: "c1", milestones: ms, event: "FUNDED" })).resolves.toBe(0);
  });
});
