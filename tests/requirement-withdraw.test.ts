import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A donor withdrawing a CSR requirement. The state machine (owner only, never
 * mid-run, never once a proposal is selected), the compare-and-swap write, and
 * the NGO side: every open response is closed and its NGO notified.
 */

const db = vi.hoisted(() => ({
  sponsorRequirement: { findUnique: vi.fn(), updateMany: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  requirementRevision: { create: vi.fn() },
  opportunityResponse: { findMany: vi.fn(), updateMany: vi.fn() },
  notification: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readPrivateFile: vi.fn() }));

import { canTransition, DONOR_WITHDRAWABLE } from "@/lib/requirements/status";
import { withdrawRequirement } from "@/lib/requirements/workflow";

const OWNER = { id: "donor-1", role: "DONOR" as const, name: null, email: null };
const req = (status: string) => ({ id: "req-1", sponsorId: "donor-1", status, version: 3, extractedFields: {}, versionNote: null, versionAuthorId: null, versionAuthorRole: null });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.sponsorRequirement.updateMany.mockResolvedValue({ count: 1 });
  db.opportunityResponse.findMany.mockResolvedValue([]);
});

describe("state machine", () => {
  it("the donor may withdraw from every settled pre-selection stage", () => {
    expect([...DONOR_WITHDRAWABLE].sort()).toEqual(
      ["AI_EXTRACTED", "DONOR_REVIEW", "FAILED", "NEEDS_CORRECTION", "NGO_RESPONSE", "PENDING_ADMIN_REVIEW", "SHORTLISTED", "VALIDATED"].sort()
    );
  });

  it("never while the system is mid-run, never once a proposal is selected, never from a closed state", () => {
    for (const s of ["UPLOADED", "PROCESSING", "MATCHING", "SELECTED", "CONTRACTED", "REJECTED", "WITHDRAWN"] as const) {
      expect(canTransition(s, "WITHDRAWN", "DONOR")).toBe(false);
    }
  });

  it("only the donor — not an admin, an NGO or the system", () => {
    for (const role of ["ADMIN", "NGO", "SYSTEM"] as const) expect(canTransition("VALIDATED", "WITHDRAWN", role)).toBe(false);
  });
});

describe("withdrawRequirement", () => {
  it("writes WITHDRAWN with a compare-and-swap on version + status and records the reason in the audit log", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValueOnce(req("VALIDATED")).mockResolvedValue({ ...req("WITHDRAWN") });
    await withdrawRequirement("req-1", OWNER, "Budget moved to next financial year.");
    expect(db.sponsorRequirement.updateMany).toHaveBeenCalledWith({
      where: { id: "req-1", version: 3, status: "VALIDATED" },
      data: { status: "WITHDRAWN" },
    });
    expect(db.requirementAuditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "REQUIREMENT_WITHDRAWN",
      actorRole: "DONOR",
      fromStatus: "VALIDATED",
      toStatus: "WITHDRAWN",
      detail: "Budget moved to next financial year.",
    });
  });

  it("closes every open NGO response and tells each NGO, without judging the proposal", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValueOnce(req("NGO_RESPONSE")).mockResolvedValue({ ...req("WITHDRAWN") });
    db.opportunityResponse.findMany.mockResolvedValue([
      { id: "resp-1", ngo: { userId: "ngo-user-1" } },
      { id: "resp-2", ngo: { userId: "ngo-user-2" } },
    ]);
    await withdrawRequirement("req-1", OWNER, "Budget moved to next financial year.");
    expect(db.opportunityResponse.findMany.mock.calls[0][0].where).toEqual({ requirementId: "req-1", status: { notIn: ["REJECTED", "SELECTED"] } });
    expect(db.opportunityResponse.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["resp-1", "resp-2"] } },
      data: expect.objectContaining({ status: "REJECTED" }),
    });
    const notes = db.notification.createMany.mock.calls[0][0].data;
    expect(notes.map((x: any) => x.userId)).toEqual(["ngo-user-1", "ngo-user-2"]);
    expect(notes[0].body).toContain("not a judgement");
  });

  it("someone else's requirement is refused before anything is written", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue({ ...req("VALIDATED"), sponsorId: "donor-2" });
    await expect(withdrawRequirement("req-1", OWNER, "Budget moved to next year.")).rejects.toMatchObject({ status: 403 });
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
  });

  it("an admin cannot withdraw on the donor's behalf", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(req("VALIDATED"));
    await expect(withdrawRequirement("req-1", { ...OWNER, id: "admin-1", role: "ADMIN" }, "Budget moved to next year.")).rejects.toMatchObject({ status: 403 });
  });

  it("a reason is required", async () => {
    await expect(withdrawRequirement("req-1", OWNER, "short")).rejects.toMatchObject({ status: 400 });
    expect(db.sponsorRequirement.findUnique).not.toHaveBeenCalled();
  });

  it("a selected requirement cannot be withdrawn (400) and a concurrent change is a 409", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(req("SELECTED"));
    await expect(withdrawRequirement("req-1", OWNER, "Budget moved to next year.")).rejects.toMatchObject({ status: 400 });
    db.sponsorRequirement.findUnique.mockResolvedValue(req("VALIDATED"));
    db.sponsorRequirement.updateMany.mockResolvedValue({ count: 0 });
    await expect(withdrawRequirement("req-1", OWNER, "Budget moved to next year.")).rejects.toMatchObject({ status: 409 });
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });
});
