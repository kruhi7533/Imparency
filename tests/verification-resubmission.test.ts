import { describe, it, expect, vi, beforeEach } from "vitest";

// Acceptance report v2, defect D1 (ADM-002 / E2E-001): an NGO whose first
// documents raised an identity conflict resubmitted corrected documents, the
// re-analysis came back SAFE, and verify-ngo still refused on the stale OPEN
// review. These tests pin the supersede rules and the listing API.

vi.mock("@/lib/prisma", () => ({
  default: {
    riskReview: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    fraudAlert: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    nGOProfile: { findUnique: vi.fn() },
    notification: { create: vi.fn() },
  },
}));
vi.mock("@/lib/fraud-alerts", () => ({ createFraudAlert: vi.fn() }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/extraction-runner", () => ({ namesMatch: () => true }));
vi.mock("@/lib/gemini/extract-ngo-fields", () => ({ FIELD_LABELS: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendNGOSuspendedEmail: vi.fn(), sendNGOReinstatedEmail: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { createFraudAlert } from "@/lib/fraud-alerts";
import { applyTriage, isTriageReview, TRIAGE_SUPERSEDED_NOTE } from "@/lib/verification-triage";
import { GET } from "@/app/api/admin/risk/review/route";

const db = prisma as any;

const identityConflict = {
  fieldKey: "orgName",
  severity: "HIGH",
  issue: "Registration certificate names a different organisation",
};

const safe = { verdict: "SAFE", riskLevel: "LOW", findings: [], ngoFacingIssues: [], summary: "clean" } as any;
const defective = {
  verdict: "NEEDS_RISK_REVIEW",
  riskLevel: "HIGH",
  findings: [identityConflict],
  ngoFacingIssues: [],
  summary: "conflict",
} as any;

const triageReview = { id: "rev_triage", reviewedBy: null, findings: [identityConflict] };
const adminFlag = { id: "rev_admin", reviewedBy: "admin_1", findings: [] };
const agentReview = { id: "rev_agent", reviewedBy: null, findings: { reason: "TWO_CONSECUTIVE_LOW_PROOF_SCORES" } };

beforeEach(() => {
  vi.clearAllMocks();
  db.fraudAlert.updateMany.mockResolvedValue({ count: 0 });
  db.riskReview.updateMany.mockResolvedValue({ count: 1 });
});

describe("isTriageReview", () => {
  it("recognises only reviews triage opened", () => {
    expect(isTriageReview(triageReview)).toBe(true);
    expect(isTriageReview(adminFlag)).toBe(false);
    expect(isTriageReview(agentReview)).toBe(false);
  });
});

describe("applyTriage after a document resubmission", () => {
  it("a SAFE re-run clears triage's stale OPEN review (D1)", async () => {
    db.riskReview.findMany.mockResolvedValue([triageReview]);
    await applyTriage("ngo_1", safe);

    expect(db.riskReview.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rev_triage"] }, status: "OPEN" },
      data: expect.objectContaining({ status: "CLEARED", reviewNote: TRIAGE_SUPERSEDED_NOTE }),
    });
    expect(db.riskReview.create).not.toHaveBeenCalled();
  });

  it("a SAFE re-run resolves the verification alerts the old documents raised", async () => {
    db.riskReview.findMany.mockResolvedValue([triageReview]);
    await applyTriage("ngo_1", safe);
    expect(db.fraudAlert.updateMany).toHaveBeenCalledWith({
      where: { type: "VERIFICATION_DEFECT", entityId: "ngo_1", resolved: false },
      data: expect.objectContaining({ resolved: true }),
    });
  });

  it("never clears a review an admin or the fraud agent opened", async () => {
    db.riskReview.findMany.mockResolvedValue([adminFlag, agentReview]);
    await applyTriage("ngo_1", safe);
    expect(db.riskReview.updateMany).not.toHaveBeenCalled();
    expect(db.riskReview.update).not.toHaveBeenCalled();
  });

  it("a defective re-run rewrites triage's review, not the admin's flag", async () => {
    db.riskReview.findMany.mockResolvedValue([adminFlag, triageReview]);
    await applyTriage("ngo_1", defective);
    expect(db.riskReview.update).toHaveBeenCalledWith({
      where: { id: "rev_triage" },
      data: { riskLevel: "HIGH", findings: [identityConflict] },
    });
    expect(db.riskReview.create).not.toHaveBeenCalled();
    expect(createFraudAlert).toHaveBeenCalledTimes(1);
  });

  it("a defective run with only an admin flag open opens its own review", async () => {
    db.riskReview.findMany.mockResolvedValue([adminFlag]);
    await applyTriage("ngo_1", defective);
    expect(db.riskReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ngoId: "ngo_1", status: "OPEN", riskLevel: "HIGH" }),
    });
  });

  it("keeps alerts whose finding still holds and resolves the rest", async () => {
    db.riskReview.findMany.mockResolvedValue([triageReview]);
    await applyTriage("ngo_1", defective);
    expect(db.fraudAlert.updateMany).toHaveBeenCalledWith({
      where: {
        type: "VERIFICATION_DEFECT",
        entityId: "ngo_1",
        resolved: false,
        description: { notIn: [identityConflict.issue] },
      },
      data: expect.objectContaining({ resolved: true }),
    });
  });

  it("repeated SAFE runs are idempotent (nothing open, nothing written)", async () => {
    db.riskReview.findMany.mockResolvedValue([]);
    await applyTriage("ngo_1", safe);
    await applyTriage("ngo_1", safe);
    expect(db.riskReview.updateMany).not.toHaveBeenCalled();
    expect(db.riskReview.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/risk/review", () => {
  const req = (qs = "") => new Request(`http://localhost/api/admin/risk/review${qs}`) as any;

  it("refuses non-admins", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "u1", role: "NGO" } });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("lists reviews filtered by status and NGO", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    db.riskReview.count.mockResolvedValue(1);
    db.riskReview.findMany.mockResolvedValue([{ id: "rev_triage" }]);
    const res = await GET(req("?status=open&ngoId=ngo_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toEqual([{ id: "rev_triage" }]);
    expect(db.riskReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "OPEN", ngoId: "ngo_1" }, take: 25, skip: 0 })
    );
  });

  it("rejects an unknown status", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    const res = await GET(req("?status=bogus"));
    expect(res.status).toBe(400);
  });
});
