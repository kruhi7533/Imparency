import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  sponsorRequirement: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  requirementRevision: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import { SponsorRequirementRepository } from "@/src/agents/requirements-agent/repositories/requirement.repository";

const aiFields = {
  sector: { value: "Education", confidence: 0.9, source: "AI_EXTRACTED" },
  budgetMax: { value: 1000000, confidence: 0.6, source: "AI_EXTRACTED" },
};

function current(over: Record<string, unknown> = {}) {
  return {
    id: "req-123",
    status: "DONOR_REVIEW",
    version: 1,
    extractedFields: aiFields,
    versionNote: "AI extraction",
    versionAuthorId: null,
    versionAuthorRole: "SYSTEM",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.sponsorRequirement.updateMany.mockResolvedValue({ count: 1 });
  db.requirementAuditLog.create.mockResolvedValue({});
});

describe("SponsorRequirement versioning", () => {
  it("the first extraction fills the empty upload placeholder and stays v1 (no empty snapshot)", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(current({ extractedFields: {}, versionNote: null, versionAuthorRole: null }));
    await SponsorRequirementRepository.update("req-123", { extractedFields: aiFields }, { actorId: null, actorRole: "SYSTEM", changeSummary: "AI extraction" });

    expect(db.requirementRevision.create).not.toHaveBeenCalled();
    expect(db.sponsorRequirement.updateMany.mock.calls[0][0].data.version).toBe(1);
  });

  it("an edit snapshots the previous version — labelled with how THAT version was made — and increments", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(current());
    const edited = { ...aiFields, budgetMax: { value: 1500000, confidence: 1, source: "DONOR_CORRECTED" } };
    await SponsorRequirementRepository.update("req-123", { extractedFields: edited }, { actorId: "donor-1", actorRole: "DONOR", changeSummary: "Donor corrected maximum budget" });

    expect(db.requirementRevision.create).toHaveBeenCalledWith({
      data: {
        sponsorRequirementId: "req-123",
        version: 1,
        extractedFields: aiFields,
        changeSummary: "AI extraction",
        changedById: null,
        changedByRole: "SYSTEM",
        status: "DONOR_REVIEW",
      },
    });
    const { where, data } = db.sponsorRequirement.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "req-123", version: 1, status: "DONOR_REVIEW" });
    expect(data).toMatchObject({ version: 2, versionNote: "Donor corrected maximum budget", versionAuthorId: "donor-1", versionAuthorRole: "DONOR" });
    expect(data.extractedFields.budgetMax.source).toBe("DONOR_CORRECTED");
  });

  it("multiple edits preserve every earlier version", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValueOnce(current()).mockResolvedValueOnce(current());
    await SponsorRequirementRepository.update("req-123", { extractedFields: aiFields }, { actorId: "donor-1", actorRole: "DONOR", changeSummary: "v2" });

    db.sponsorRequirement.findUnique
      .mockResolvedValueOnce(current({ version: 2, versionNote: "v2", versionAuthorId: "donor-1", versionAuthorRole: "DONOR" }))
      .mockResolvedValueOnce(current({ version: 3 }));
    await SponsorRequirementRepository.update("req-123", { extractedFields: aiFields }, { actorId: "admin-1", actorRole: "ADMIN", changeSummary: "Admin verified" });

    const snapshots = db.requirementRevision.create.mock.calls.map((c: any) => [c[0].data.version, c[0].data.changeSummary, c[0].data.changedByRole]);
    expect(snapshots).toEqual([
      [1, "AI extraction", "SYSTEM"],
      [2, "v2", "DONOR"],
    ]);
    expect(db.sponsorRequirement.updateMany.mock.calls.map((c: any) => c[0].data.version)).toEqual([2, 3]);
  });

  it("a concurrent change is a 409 conflict, never a silent overwrite", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(current());
    db.sponsorRequirement.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      SponsorRequirementRepository.update("req-123", { extractedFields: aiFields }, { actorId: "donor-1", actorRole: "DONOR", changeSummary: "x" })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("duplicate detection", () => {
  it("only matches the uploading sponsor's own completed uploads", async () => {
    db.sponsorRequirement.findFirst.mockResolvedValueOnce(null);
    await SponsorRequirementRepository.findByHash("hash-abc", "sponsor-B");
    expect(db.sponsorRequirement.findFirst).toHaveBeenCalledWith({
      where: { fileHash: "hash-abc", sponsorId: "sponsor-B", status: { notIn: ["FAILED", "UPLOADED", "PROCESSING"] } },
      orderBy: { createdAt: "desc" },
    });
  });
});
