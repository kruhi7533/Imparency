import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Week 7 — beneficiary consent withdrawal (P0 privacy).
 *
 *  - tenant isolation: another NGO cannot withdraw (or learn of) our feedback;
 *  - idempotency: a repeat or a lost race returns the existing withdrawal;
 *  - effect: a withdrawn consent makes the photo donor-invisible and erases
 *    the feedback content captured under it.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    beneficiaryFeedback: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { checkWithdrawal, isShareableWithDonor, withdrawalData } from "@/lib/field-evidence";
import { POST as WITHDRAW } from "@/app/api/field/feedback/[id]/withdraw/route";

const prismaMock = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const call = (id = "fb-1") => WITHDRAW(new Request("http://test", { method: "POST" }), { params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  // u-owner owns ngo-a, u-field is ngo-a FIELD_STAFF, u-other owns ngo-b.
  prismaMock.nGOProfile.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-owner" ? { id: "ngo-a" } : where.userId === "u-other" ? { id: "ngo-b" } : null),
  );
  prismaMock.nGOTeamMember.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-field" ? { ngoId: "ngo-a", role: "FIELD_STAFF" } : null),
  );
  prismaMock.beneficiaryFeedback.findUnique.mockResolvedValue({ id: "fb-1", ngoId: "ngo-a", withdrawnAt: null });
  prismaMock.beneficiaryFeedback.updateMany.mockResolvedValue({ count: 1 });
});

describe("checkWithdrawal", () => {
  it("allows the owning NGO", () => {
    expect(checkWithdrawal({ ngoId: "ngo-a", withdrawnAt: null }, "ngo-a")).toEqual({ ok: true, noop: false });
  });
  it("is a no-op once withdrawn", () => {
    expect(checkWithdrawal({ ngoId: "ngo-a", withdrawnAt: new Date() }, "ngo-a")).toEqual({ ok: true, noop: true });
  });
  it("hides another NGO's row as not found", () => {
    expect(checkWithdrawal({ ngoId: "ngo-b", withdrawnAt: null }, "ngo-a")).toMatchObject({ ok: false, status: 404 });
    expect(checkWithdrawal(null, "ngo-a")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("withdrawalData", () => {
  it("erases the content gathered under consent and records who and when", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    expect(withdrawalData("u-field", now)).toEqual({ withdrawnAt: now, withdrawnById: "u-field", rating: null, feedbackText: null });
  });
  it("makes an approved, people-showing photo donor-invisible", () => {
    const evidence = { status: "APPROVED" as any, containsPeople: true };
    expect(isShareableWithDonor(evidence, { consentToSharePhoto: true, withdrawnAt: null })).toBe(true);
    expect(isShareableWithDonor(evidence, { consentToSharePhoto: true, withdrawnAt: new Date() })).toBe(false);
  });
});

describe("POST /api/field/feedback/[id]/withdraw", () => {
  it("lets field staff record a withdrawal for their own NGO", async () => {
    session("u-field", "NGO");
    const res = await call();
    expect(res.status).toBe(200);
    const where = prismaMock.beneficiaryFeedback.updateMany.mock.calls[0][0].where;
    expect(where).toEqual({ id: "fb-1", ngoId: "ngo-a", withdrawnAt: null });
    const data = prismaMock.beneficiaryFeedback.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ withdrawnById: "u-field", rating: null, feedbackText: null });
  });

  it("returns 404 to another NGO and writes nothing", async () => {
    session("u-other", "NGO");
    const res = await call();
    expect(res.status).toBe(404);
    expect(prismaMock.beneficiaryFeedback.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a non-NGO session", async () => {
    session("u-donor", "DONOR");
    const res = await call();
    expect(res.status).toBe(403);
    expect(prismaMock.beneficiaryFeedback.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an NGO-role user with no membership", async () => {
    session("u-nobody", "NGO");
    expect((await call()).status).toBe(403);
  });

  it("is idempotent: an already-withdrawn row is not rewritten", async () => {
    session("u-owner", "NGO");
    const at = new Date("2026-10-07T00:00:00Z");
    prismaMock.beneficiaryFeedback.findUnique.mockResolvedValue({ id: "fb-1", ngoId: "ngo-a", withdrawnAt: at });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(prismaMock.beneficiaryFeedback.updateMany).not.toHaveBeenCalled();
  });

  it("treats a lost concurrent race as success, not an error", async () => {
    session("u-owner", "NGO");
    prismaMock.beneficiaryFeedback.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.beneficiaryFeedback.findUnique
      .mockResolvedValueOnce({ id: "fb-1", ngoId: "ngo-a", withdrawnAt: null })
      .mockResolvedValueOnce({ withdrawnAt: new Date() });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
  });
});
