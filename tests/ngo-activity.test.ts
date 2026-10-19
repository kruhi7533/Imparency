import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The NGO's own activity history. What matters is what it does NOT show:
 * internal admin investigation steps, admin notes, staff names, and anything
 * belonging to another organisation.
 */

const db = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn() },
  adminActionLog: { findMany: vi.fn() },
  complianceAuditLog: { findMany: vi.fn() },
  contractAuditLog: { findMany: vi.fn() },
  milestoneReview: { findMany: vi.fn() },
  fieldEvidence: { findMany: vi.fn() },
  outcomeClaim: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));

import { loadNgoActivity, mergeActivity, NGO_VISIBLE_ADMIN_ACTIONS, REVIEWER } from "@/lib/ngo-activity";

const d = (s: string) => new Date(s);

beforeEach(() => {
  vi.clearAllMocks();
  db.nGOProfile.findUnique.mockResolvedValue({
    userId: "owner-a",
    user: { name: "Asha Owner" },
    teamMembers: [{ userId: "fin-a", user: { name: "Farah Finance" } }],
    compliance: { id: "comp-a" },
    projects: [
      { id: "proj-a", title: "Digital classrooms", fundedAt: d("2026-10-20") },
      { id: "proj-b", title: "Literacy kits", fundedAt: null },
    ],
  });
  db.adminActionLog.findMany.mockResolvedValue([{ action: "PROJECT_APPROVED", entityType: "PROJECT", entityId: "proj-a", createdAt: d("2026-09-01") }]);
  db.complianceAuditLog.findMany.mockResolvedValue([{ event: "PAN_VERIFIED", detail: "PAN validated.", createdAt: d("2026-08-01") }]);
  db.contractAuditLog.findMany.mockResolvedValue([
    { action: "PAYMENT_CONFIRMED", actorId: "fin-a", actorRole: "NGO", detail: null, createdAt: d("2026-10-19"), contractId: "c-1", contract: { title: "CSR grant" } },
    { action: "PAYMENT_RECORDED", actorId: "donor-9", actorRole: "DONOR", detail: null, createdAt: d("2026-10-18"), contractId: "c-1", contract: { title: "CSR grant" } },
  ]);
  db.milestoneReview.findMany.mockResolvedValue([
    { action: "REJECTED", note: "Photos are blurry.", reviewedAt: d("2026-09-10"), milestone: { title: "Installation", projectId: "proj-a" } },
  ]);
  db.fieldEvidence.findMany.mockResolvedValue([
    { status: "APPROVED", reviewNote: null, reviewedAt: d("2026-09-15"), projectId: "proj-a", task: { title: "Photograph projectors" } },
  ]);
  db.outcomeClaim.findMany.mockResolvedValue([
    { status: "NEEDS_EVIDENCE", submittedAt: d("2026-09-20"), submittedById: "owner-a", decidedAt: d("2026-09-22"), decisionNote: "Cite the attendance sheet.", metric: { name: "Students reached" }, projectId: "proj-a" },
  ]);
});

describe("loadNgoActivity", () => {
  it("merges every source newest first", async () => {
    const items = await loadNgoActivity("ngo-a");
    expect(items.map((i) => i.kind)).toEqual(["FUNDING", "CONTRACT", "CONTRACT", "OUTCOME", "OUTCOME", "FIELD", "PROOF", "PROJECT", "COMPLIANCE"]);
    expect(items[0].title).toContain("Digital classrooms");
  });

  it("asks only for allowlisted admin actions, scoped to this NGO and its own projects", async () => {
    await loadNgoActivity("ngo-a");
    const where = db.adminActionLog.findMany.mock.calls[0][0].where;
    expect(where.action.in).toEqual(Object.keys(NGO_VISIBLE_ADMIN_ACTIONS));
    expect(where.action.in).not.toContain("NGO_FLAGGED_FOR_RISK");
    expect(where.action.in).not.toContain("NGO_TRUST_INSIGHT_RUN");
    expect(where.OR).toEqual([
      { entityType: "NGO", entityId: "ngo-a" },
      { entityType: "PROJECT", entityId: { in: ["proj-a", "proj-b"] } },
    ]);
    // Never selects the admin's note or identity.
    expect(db.adminActionLog.findMany.mock.calls[0][0].select).not.toHaveProperty("note");
    expect(db.adminActionLog.findMany.mock.calls[0][0].select).not.toHaveProperty("adminId");
  });

  it("every other source is scoped to this NGO", async () => {
    await loadNgoActivity("ngo-a");
    expect(db.contractAuditLog.findMany.mock.calls[0][0].where).toEqual({ contract: { ngoId: "ngo-a" } });
    expect(db.milestoneReview.findMany.mock.calls[0][0].where).toEqual({ milestone: { project: { ngoId: "ngo-a" } } });
    expect(db.fieldEvidence.findMany.mock.calls[0][0].where).toMatchObject({ ngoId: "ngo-a" });
    expect(db.outcomeClaim.findMany.mock.calls[0][0].where).toMatchObject({ ngoId: "ngo-a" });
    expect(db.complianceAuditLog.findMany.mock.calls[0][0].where).toEqual({ complianceId: "comp-a" });
  });

  it("names the NGO's own people; platform staff are 'Platform reviewer', funders 'Funder'", async () => {
    const items = await loadNgoActivity("ngo-a");
    const actors = items.map((i) => i.actor);
    expect(actors).toContain("Farah Finance");
    expect(actors).toContain("Funder");
    expect(actors).toContain("Asha Owner");
    expect(items.find((i) => i.kind === "PROOF")!.actor).toBe(REVIEWER);
    expect(actors).not.toContain("donor-9");
  });

  it("shows review notes written for the NGO (proof rejection, evidence return)", async () => {
    const items = await loadNgoActivity("ngo-a");
    expect(items.find((i) => i.kind === "PROOF")!.detail).toBe("Photos are blurry.");
    expect(items.find((i) => i.title.startsWith("Outcome claim returned"))!.detail).toBe("Cite the attendance sheet.");
  });

  it("an NGO with no compliance record skips that source; an unknown NGO is empty", async () => {
    db.nGOProfile.findUnique.mockResolvedValueOnce({ userId: "o", user: { name: null }, teamMembers: [], compliance: null, projects: [] });
    await loadNgoActivity("ngo-a");
    expect(db.complianceAuditLog.findMany).not.toHaveBeenCalled();
    db.nGOProfile.findUnique.mockResolvedValueOnce(null);
    expect(await loadNgoActivity("nope")).toEqual([]);
  });
});

describe("mergeActivity", () => {
  it("sorts newest first and caps", () => {
    const item = (at: string, title: string) => ({ at: d(at), kind: "PROJECT" as const, title, detail: null, actor: "x", href: null });
    const out = mergeActivity([[item("2026-01-01", "a"), item("2026-03-01", "c")], [item("2026-02-01", "b")]], 2);
    expect(out.map((i) => i.title)).toEqual(["c", "b"]);
  });
});
