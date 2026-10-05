import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Week 7 donor — funded project view and milestone updates.
 *
 *  - Tenant isolation: the funded page is 404 unless THIS donor funds the
 *    project through an ACTIVE/COMPLETED contract.
 *  - Approval/consent gate: the page queries evidence only through
 *    DONOR_VISIBLE_EVIDENCE_WHERE, and donors are only notified about evidence
 *    they are allowed to open.
 *  - Contract donors (no donation row) receive milestone updates.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    contract: { findMany: vi.fn() },
    project: { findUnique: vi.fn() },
    milestone: { findUnique: vi.fn() },
    fieldEvidence: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    fieldTask: { updateMany: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prismaMock)),
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/notification", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { sendPushNotification } from "@/lib/notification";
import { contractDonorIds, notifyContractDonors, notifyContractDonorsMilestoneCompleted } from "@/lib/contract-donor-updates";
import { DONOR_VISIBLE_EVIDENCE_WHERE } from "@/lib/field-evidence";
import { PATCH as REVIEW } from "@/app/api/admin/field-evidence/[id]/route";
import DonorFundedProjectPage from "@/app/donor/funded/[projectId]/page";

const prismaMock = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((cb: any) => cb(prismaMock));
  (sendPushNotification as any).mockResolvedValue(undefined);
});

describe("contract donor notifications", () => {
  it("targets each funding donor once, only on ACTIVE/COMPLETED contracts", async () => {
    prismaMock.contract.findMany.mockResolvedValue([{ donorId: "d1" }, { donorId: "d2" }, { donorId: "d1" }]);
    expect(await contractDonorIds("p1")).toEqual(["d1", "d2"]);
    expect(prismaMock.contract.findMany.mock.calls[0][0].where).toEqual({ projectId: "p1", status: { in: ["ACTIVE", "COMPLETED"] } });
  });

  it("one donor's failed push does not stop the others or throw", async () => {
    prismaMock.contract.findMany.mockResolvedValue([{ donorId: "d1" }, { donorId: "d2" }]);
    (sendPushNotification as any).mockRejectedValueOnce(new Error("fcm down"));
    await expect(notifyContractDonors("p1", "t", "b")).resolves.toEqual({ notified: 1, failed: 1 });
    expect(sendPushNotification).toHaveBeenCalledTimes(2);
  });

  it("a database failure is swallowed — the review that caused it must not fail", async () => {
    prismaMock.contract.findMany.mockRejectedValue(new Error("db down"));
    await expect(notifyContractDonors("p1", "t", "b")).resolves.toEqual({ notified: 0, failed: 0 });
  });

  it("milestone completion notifies contract donors with no PII in the message", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({ title: "Roof built", projectId: "p1", project: { title: "School" } });
    prismaMock.contract.findMany.mockResolvedValue([{ donorId: "d1" }]);
    await notifyContractDonorsMilestoneCompleted("m1");
    const [userId, title, body, data] = (sendPushNotification as any).mock.calls[0];
    expect(userId).toBe("d1");
    expect(title).toBe("Milestone completed");
    expect(body).toContain("Roof built");
    expect(data).toEqual({ projectId: "p1", link: "/donor/funded/p1" });
  });
});

describe("evidence approval notifies donors only about evidence they can see", () => {
  const evidence = (over: Record<string, unknown> = {}) => ({
    id: "ev-1",
    status: "PENDING_REVIEW",
    taskId: "t1",
    projectId: "p1",
    containsPeople: true,
    feedback: { consentToSharePhoto: true, withdrawnAt: null },
    task: { project: { title: "School" }, milestone: { title: "Roof" } },
    ...over,
  });
  const approve = () =>
    REVIEW(new Request("http://test", { method: "PATCH", body: JSON.stringify({ decision: "APPROVE" }) }), { params: { id: "ev-1" } });

  beforeEach(() => {
    session("admin-1", "ADMIN");
    prismaMock.fieldEvidence.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.contract.findMany.mockResolvedValue([{ donorId: "d1" }]);
  });

  it("approved + consented → donors notified", async () => {
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(evidence());
    expect((await approve()).status).toBe(200);
    expect(sendPushNotification).toHaveBeenCalledWith("d1", "New verified field update", expect.stringContaining("Roof"), expect.any(Object));
  });

  it("approved but people shown without share consent → silent", async () => {
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(evidence({ feedback: null }));
    expect((await approve()).status).toBe(200);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("approved, no people in photo → donors notified without a consent record", async () => {
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(evidence({ containsPeople: false, feedback: null }));
    await approve();
    expect(sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it("a repeated approval (no-op) does not notify again", async () => {
    prismaMock.fieldEvidence.findUnique.mockResolvedValue(evidence({ status: "APPROVED" }));
    expect((await approve()).status).toBe(200);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });
});

describe("/donor/funded/[projectId] page", () => {
  const render = () => DonorFundedProjectPage({ params: { projectId: "p1" } });

  it("a donor who does not fund the project gets 404", async () => {
    session("donor-b", "DONOR");
    prismaMock.contract.findMany.mockResolvedValue([]);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(prismaMock.contract.findMany.mock.calls[0][0].where).toEqual({
      donorId: "donor-b",
      projectId: "p1",
      status: { in: ["ACTIVE", "COMPLETED"] },
    });
    expect(prismaMock.fieldEvidence.findMany).not.toHaveBeenCalled();
  });

  it("non-donors are redirected", async () => {
    session("u-owner", "NGO");
    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
  });

  it("a funding donor's evidence query is the consent-gated rule, scoped to the project", async () => {
    session("donor-a", "DONOR");
    prismaMock.contract.findMany.mockResolvedValue([
      { id: "c1", contractNumber: "CTR-1", totalGrantAmount: "100", milestones: [], payments: [] },
    ]);
    prismaMock.project.findUnique.mockResolvedValue({
      id: "p1",
      title: "School",
      location: "Pune",
      ngo: { orgName: "NGO A" },
      milestones: [],
    });
    prismaMock.fieldEvidence.findMany.mockResolvedValue([]);
    await render();
    expect(prismaMock.fieldEvidence.findMany.mock.calls[0][0].where).toEqual({ projectId: "p1", ...DONOR_VISIBLE_EVIDENCE_WHERE });
  });
});
