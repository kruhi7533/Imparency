/**
 * Human gates added for D3:
 *   DON-004  manual entry from a FAILED extraction (FAILED → DONOR_REVIEW, owner only)
 *   AI-002 / NEG-004  blocking extraction flags must be confirmed (with a note)
 *            before submit or admin validation
 *   ADM-006 / E2E-002  admin approve / reject / reorder of the shortlist before
 *            any NGO is invited; donors invite only admin-approved candidates
 * Prisma mocked; tenant isolation and audit rows asserted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  sponsorRequirement: { findUnique: vi.fn(), updateMany: vi.fn() },
  requirementRevision: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  gapReport: { findFirst: vi.fn(), update: vi.fn() },
  requirementMatch: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  adminActionLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn(async () => {}) }));
vi.mock("@/lib/storage", () => ({ readPrivateFile: vi.fn() }));

import { logAdminAction } from "@/lib/admin-log";
import {
  startManualEntry,
  confirmExtractionFlag,
  submitForAdminReview,
  approveRequirement,
  reviewShortlist,
  inviteMatch,
} from "@/lib/requirements/workflow";
import type { Actor } from "@/lib/requirements/access";

const OWNER: Actor = { id: "donor-1", role: "DONOR", name: null, email: null, accountId: "donor-1", donorRole: "OWNER" };
const OTHER: Actor = { id: "donor-2", role: "DONOR", name: null, email: null, accountId: "donor-2", donorRole: "OWNER" };
const ADMIN: Actor = { id: "admin-1", role: "ADMIN", name: null, email: null };

let row: any;
const req = (over: Record<string, unknown> = {}) => ({
  id: "req-1",
  sponsorId: "donor-1",
  status: "FAILED",
  version: 1,
  extractedFields: {},
  extractionFlags: null,
  extractionError: { code: "EXTRACTION_PROVIDER_UNAVAILABLE" },
  versionNote: null,
  versionAuthorId: null,
  versionAuthorRole: null,
  ...over,
});

const FLAGS = [
  { id: "BUDGET_CONFLICT", code: "BUDGET_CONFLICT", severity: "HIGH", message: "m", evidence: ["a", "b"], fields: ["budgetMax"], blocking: true },
  { id: "PROMPT_INJECTION_SUSPECTED", code: "PROMPT_INJECTION_SUSPECTED", severity: "HIGH", message: "m", evidence: ["Ignore…"], fields: [], blocking: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  row = req();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.sponsorRequirement.findUnique.mockImplementation(async () => row);
  db.sponsorRequirement.updateMany.mockImplementation(async ({ data }: any) => {
    row = { ...row, ...data };
    return { count: 1 };
  });
  db.requirementAuditLog.create.mockResolvedValue({});
});

describe("DON-004 — manual entry from a failed upload", () => {
  it("the owner moves FAILED → DONOR_REVIEW with blank DONOR_ENTERED fields (nothing fabricated)", async () => {
    const out = await startManualEntry("req-1", OWNER);
    expect(out.status).toBe("DONOR_REVIEW");
    const fields = out.extractedFields as any;
    expect(fields.sector).toEqual({ value: null, confidence: 0, source: "DONOR_ENTERED" });
    expect(fields.budgetMax.value).toBeNull();
    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "REQUIREMENT_MANUAL_ENTRY_STARTED", fromStatus: "FAILED", toStatus: "DONOR_REVIEW" }),
    });
  });

  it("another donor gets 403; an admin cannot do it on the donor's behalf; only from FAILED", async () => {
    await expect(startManualEntry("req-1", OTHER)).rejects.toMatchObject({ status: 403 });
    await expect(startManualEntry("req-1", ADMIN)).rejects.toMatchObject({ status: 403 });
    row = req({ status: "AI_EXTRACTED" });
    await expect(startManualEntry("req-1", OWNER)).rejects.toMatchObject({ status: 400 });
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
  });
});

describe("AI-002 / NEG-004 — blocking extraction flags need human confirmation", () => {
  it("submit for admin review is refused (409 FLAGS_UNCONFIRMED) while a blocking flag is open", async () => {
    row = req({ status: "DONOR_REVIEW", extractionFlags: FLAGS });
    await expect(submitForAdminReview("req-1", OWNER)).rejects.toMatchObject({ status: 409, code: "FLAGS_UNCONFIRMED" });
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
  });

  it("admin validation is refused too", async () => {
    row = req({ status: "PENDING_ADMIN_REVIEW", extractionFlags: FLAGS, extractedFields: { sector: { value: "Education", confidence: 1 } } });
    await expect(approveRequirement("req-1", ADMIN, null)).rejects.toMatchObject({ status: 409, code: "FLAGS_UNCONFIRMED" });
  });

  it("the owner confirms each flag with a note (audited); then submission goes through", async () => {
    row = req({ status: "DONOR_REVIEW", extractionFlags: FLAGS });
    await expect(confirmExtractionFlag("req-1", OWNER, "BUDGET_CONFLICT", "")).rejects.toMatchObject({ status: 400 });
    await confirmExtractionFlag("req-1", OWNER, "BUDGET_CONFLICT", "Budget is INR 50 lakh per the board note");
    expect(row.extractionFlags[0]).toMatchObject({ confirmedById: "donor-1", confirmedByRole: "DONOR", confirmationNote: expect.stringContaining("50 lakh") });
    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "REQUIREMENT_FLAG_CONFIRMED", metadata: { flagId: "BUDGET_CONFLICT", code: "BUDGET_CONFLICT" } }),
    });
    await expect(submitForAdminReview("req-1", OWNER)).rejects.toMatchObject({ code: "FLAGS_UNCONFIRMED" });

    await confirmExtractionFlag("req-1", OWNER, "PROMPT_INJECTION_SUSPECTED", "Checked: instruction text was not applied");
    const out = await submitForAdminReview("req-1", OWNER);
    expect(out.status).toBe("PENDING_ADMIN_REVIEW");
  });

  it("confirming twice is a no-op; another donor cannot confirm (403)", async () => {
    row = req({ status: "DONOR_REVIEW", extractionFlags: [{ ...FLAGS[0], confirmedAt: "2026-10-27T00:00:00Z" }] });
    await confirmExtractionFlag("req-1", OWNER, "BUDGET_CONFLICT", "again, same answer");
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
    await expect(confirmExtractionFlag("req-1", OTHER, "BUDGET_CONFLICT", "not my requirement")).rejects.toMatchObject({ status: 403 });
  });
});

describe("ADM-006 / E2E-002 — admin shortlist review before invitations", () => {
  const matches = [
    { id: "m-1", eligible: true, invitedAt: null },
    { id: "m-2", eligible: true, invitedAt: null },
    { id: "m-3", eligible: true, invitedAt: null },
    { id: "m-x", eligible: false, invitedAt: null },
  ];
  beforeEach(() => {
    row = req({ status: "SHORTLISTED", extractionError: null });
    db.gapReport.findFirst.mockResolvedValue({ id: "gap-1", reviewStatus: "PENDING", matches });
    db.requirementMatch.count.mockResolvedValue(0);
  });

  it("approves in the admin's order, rejects with a reason, and audits both logs (ids only)", async () => {
    const out = await reviewShortlist("req-1", ADMIN, {
      gapReportId: "gap-1",
      order: ["m-3", "m-1"],
      rejected: [{ matchId: "m-2", reason: "Duplicate project of m-1" }],
    });
    expect(out).toEqual({ gapReportId: "gap-1", order: ["m-3", "m-1"], rejected: ["m-2"] });
    expect(db.requirementMatch.update).toHaveBeenCalledWith({ where: { id: "m-3" }, data: expect.objectContaining({ adminDecision: "APPROVED", adminRank: 1 }) });
    expect(db.requirementMatch.update).toHaveBeenCalledWith({ where: { id: "m-1" }, data: expect.objectContaining({ adminDecision: "APPROVED", adminRank: 2 }) });
    expect(db.requirementMatch.update).toHaveBeenCalledWith({
      where: { id: "m-2" },
      data: expect.objectContaining({ adminDecision: "REJECTED", adminNote: "Duplicate project of m-1" }),
    });
    expect(db.gapReport.update).toHaveBeenCalledWith({ where: { id: "gap-1" }, data: expect.objectContaining({ reviewStatus: "APPROVED", reviewedBy: "admin-1" }) });
    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "SHORTLIST_ADMIN_APPROVED", actorRole: "ADMIN" }) });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "GAP_REPORT_APPROVED", entityId: "gap-1", newValue: { reviewStatus: "APPROVED", order: ["m-3", "m-1"], rejected: ["m-2"] } })
    );
  });

  it("donors cannot review the shortlist (403)", async () => {
    await expect(reviewShortlist("req-1", OWNER, { gapReportId: "gap-1", order: ["m-1", "m-2", "m-3"] })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses: an undecided eligible candidate, an ineligible one, a stale run, or a run with invitations", async () => {
    await expect(reviewShortlist("req-1", ADMIN, { gapReportId: "gap-1", order: ["m-1"] })).rejects.toMatchObject({ status: 400 });
    await expect(reviewShortlist("req-1", ADMIN, { gapReportId: "gap-1", order: ["m-1", "m-2", "m-3", "m-x"] })).rejects.toMatchObject({ status: 400 });
    await expect(
      reviewShortlist("req-1", ADMIN, { gapReportId: "gap-1", order: ["m-1", "m-2"], rejected: [{ matchId: "m-3", reason: "" }] })
    ).rejects.toMatchObject({ status: 400 });
    await expect(reviewShortlist("req-1", ADMIN, { gapReportId: "gap-OLD", order: ["m-1", "m-2", "m-3"] })).rejects.toMatchObject({ status: 409 });
    db.gapReport.findFirst.mockResolvedValue({ id: "gap-1", reviewStatus: "PENDING", matches: [{ ...matches[0], invitedAt: new Date() }, matches[1], matches[2]] });
    await expect(reviewShortlist("req-1", ADMIN, { gapReportId: "gap-1", order: ["m-1", "m-2", "m-3"] })).rejects.toMatchObject({ status: 409 });
    expect(db.gapReport.update).not.toHaveBeenCalled();
  });

  it("an invitation racing the review wins (409 inside the transaction)", async () => {
    db.requirementMatch.count.mockResolvedValue(1);
    await expect(reviewShortlist("req-1", ADMIN, { gapReportId: "gap-1", order: ["m-1", "m-2", "m-3"] })).rejects.toMatchObject({ status: 409 });
    expect(db.gapReport.update).not.toHaveBeenCalled();
  });

  const match = (over: Record<string, unknown> = {}) => ({
    id: "m-1",
    requirementId: "req-1",
    gapReportId: "gap-1",
    projectId: "p-1",
    ngoId: "n-1",
    eligible: true,
    invitedAt: null,
    adminDecision: null,
    ngo: { orgName: "Trust", verificationStatus: "VERIFIED", isSuspended: false },
    ...over,
  });

  it("the donor cannot invite before the admin approved the shortlist (409 SHORTLIST_NOT_APPROVED)", async () => {
    db.gapReport.findFirst.mockResolvedValue({ id: "gap-1", reviewStatus: "PENDING" });
    db.requirementMatch.findUnique.mockResolvedValue(match());
    await expect(inviteMatch("req-1", OWNER, "m-1")).rejects.toMatchObject({ status: 409, code: "SHORTLIST_NOT_APPROVED" });
    expect(db.requirementMatch.update).not.toHaveBeenCalled();
  });

  it("an admin-excluded candidate cannot be invited; an approved one can", async () => {
    db.gapReport.findFirst.mockResolvedValue({ id: "gap-1", reviewStatus: "APPROVED" });
    db.requirementMatch.findUnique.mockResolvedValue(match({ adminDecision: "REJECTED" }));
    await expect(inviteMatch("req-1", OWNER, "m-1")).rejects.toMatchObject({ status: 400, code: "CANDIDATE_NOT_APPROVED" });

    db.requirementMatch.findUnique.mockResolvedValue(match({ adminDecision: "APPROVED", adminRank: 1 }));
    db.requirementMatch.update.mockResolvedValue(match({ invitedAt: new Date() }));
    await inviteMatch("req-1", OWNER, "m-1");
    expect(db.requirementMatch.update).toHaveBeenCalledWith({ where: { id: "m-1" }, data: expect.objectContaining({ invitedById: "donor-1" }) });
  });

  it("another donor cannot invite on this requirement (403)", async () => {
    await expect(inviteMatch("req-1", OTHER, "m-1")).rejects.toMatchObject({ status: 403 });
  });
});
