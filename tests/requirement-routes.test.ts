import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  sponsorRequirement: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  requirementRevision: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  requirementMatch: { count: vi.fn(), createMany: vi.fn() },
  gapReport: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  opportunityResponse: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  project: { findMany: vi.fn() },
  adminActionLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readPrivateFile: vi.fn(), uploadPrivateFile: vi.fn(), deletePrivateFile: vi.fn() }));
vi.mock("@/lib/requirements/extraction", () => ({ runExtraction: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { readPrivateFile } from "@/lib/storage";
import { GET as getFile } from "@/app/api/requirements/[id]/file/route";
import { GET as getRequirement, PUT as putRequirement } from "@/app/api/requirements/[id]/route";
import { POST as submitReview } from "@/app/api/requirements/[id]/submit-review/route";
import { POST as adminApprove } from "@/app/api/requirements/[id]/admin-approve/route";
import { POST as adminReject } from "@/app/api/requirements/[id]/admin-reject/route";
import { POST as requestCorrection } from "@/app/api/requirements/[id]/request-correction/route";
import { POST as selectNgo } from "@/app/api/requirements/[id]/select/route";
import { POST as startGapAnalysis } from "@/app/api/gap-analysis/requirement/[requirementId]/route";
import { GET as getReport, PUT as putReport } from "@/app/api/gap-analysis/report/[id]/route";

const DONOR = { id: "donor-1", role: "DONOR" };
const OTHER_DONOR = { id: "donor-2", role: "DONOR" };
const ADMIN = { id: "admin-1", role: "ADMIN" };
const NGO = { id: "ngo-user-1", role: "NGO" };
const STORAGE_KEY = "requirements/1b4e28ba-2fa1-11d2-883f-0016d3cca427.pdf";

const FIELDS = {
  sector: { value: "Education", confidence: 0.95, source: "AI_EXTRACTED" },
  state: { value: "Assam", confidence: 0.95, source: "AI_EXTRACTED" },
  district: { value: "Kamrup", confidence: 0.9, source: "AI_EXTRACTED" },
  budgetMin: { value: 5000000, confidence: 0.9, source: "AI_EXTRACTED" },
  budgetMax: { value: 10000000, confidence: 0.6, source: "AI_EXTRACTED" },
  durationMonths: { value: 24, confidence: 0.9, source: "AI_EXTRACTED" },
  expectedBeneficiaries: { value: 1000, confidence: 0.9, source: "AI_EXTRACTED" },
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    sponsorId: "donor-1",
    status: "DONOR_REVIEW",
    version: 2,
    storageKey: STORAGE_KEY,
    rawDocumentUrl: "",
    mimeType: "application/pdf",
    fileName: "CSR_RFP_2026.pdf",
    fileSize: 12,
    fileHash: "abc123",
    rawText: "raw text",
    extractedFields: FIELDS,
    confidenceScores: {},
    modelVersion: "gemini-3.6-flash",
    versionNote: "AI extraction",
    versionAuthorId: null,
    versionAuthorRole: "SYSTEM",
    reviewNote: null,
    submittedAt: null,
    reviewedAt: null,
    validatedAt: null,
    selectedProjectId: null,
    selectedNgoId: null,
    selectedAt: null,
    createdAt: new Date("2026-09-15T10:00:00Z"),
    updatedAt: new Date("2026-09-15T10:00:00Z"),
    ...over,
  };
}

const signIn = (user: { id: string; role: string } | null) =>
  (getServerSession as any).mockResolvedValue(user ? { user } : null);
const ctx = { params: { id: "req-1" } };
const post = (body?: unknown) =>
  new Request("http://localhost/api", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const put = (body: unknown) => new Request("http://localhost/api", { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.sponsorRequirement.updateMany.mockResolvedValue({ count: 1 });
  db.sponsorRequirement.findUnique.mockResolvedValue(row());
  db.requirementAuditLog.create.mockResolvedValue({});
  db.adminActionLog.create.mockResolvedValue({});
  (readPrivateFile as any).mockResolvedValue(Buffer.from("%PDF-1.4 confidential"));
});

describe("document access (GET /api/requirements/[id]/file)", () => {
  const fileReq = (qs = "") => new Request(`http://localhost/api/requirements/req-1/file${qs}`);

  it("serves the owner's file inline, privately, without exposing the storage path", async () => {
    signIn(DONOR);
    const res = await getFile(fileReq(), ctx);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.4 confidential");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="CSR_RFP_2026.pdf"/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Array.from(res.headers.values()).join(" ")).not.toContain(STORAGE_KEY);
    expect(readPrivateFile).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("forces a download with ?download=1", async () => {
    signIn(DONOR);
    const res = await getFile(fileReq("?download=1"), ctx);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("lets an admin read it and records the access", async () => {
    signIn(ADMIN);
    const res = await getFile(fileReq(), ctx);
    expect(res.status).toBe(200);
    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CSR_DOCUMENT_ACCESSED", actorId: "admin-1" }),
    });
  });

  it.each([
    ["another donor", OTHER_DONOR, 403],
    ["an NGO", NGO, 403],
    ["an unauthenticated visitor", null, 401],
  ])("refuses %s without touching storage", async (_label, user, status) => {
    signIn(user as any);
    const res = await getFile(fileReq(), ctx);
    expect(res.status).toBe(status);
    expect(readPrivateFile).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown requirement", async () => {
    signIn(DONOR);
    db.sponsorRequirement.findUnique.mockResolvedValue(null);
    const res = await getFile(fileReq(), { params: { id: "nope" } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Requirement not found.");
  });
});

describe("requirement ownership", () => {
  it("returns the owner's requirement without any storage path or public URL", async () => {
    signIn(DONOR);
    const res = await getRequirement(new Request("http://localhost"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requirement.id).toBe("req-1");
    expect(JSON.stringify(body)).not.toContain(STORAGE_KEY);
    expect(body.requirement).not.toHaveProperty("storageKey");
    expect(body.requirement).not.toHaveProperty("rawDocumentUrl");
  });

  it("refuses another donor's read and write", async () => {
    signIn(OTHER_DONOR);
    expect((await getRequirement(new Request("http://localhost"), ctx)).status).toBe(403);
    const res = await putRequirement(put({ fields: { budgetMax: 1 } }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You do not have permission to access this requirement.");
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
  });

  it("an NGO cannot read a CSR requirement", async () => {
    signIn(NGO);
    expect((await getRequirement(new Request("http://localhost"), ctx)).status).toBe(403);
  });

  it("records a donor correction as a new version with DONOR_CORRECTED provenance", async () => {
    signIn(DONOR);
    const res = await putRequirement(put({ fields: { budgetMax: 7500000 } }), ctx);
    expect(res.status).toBe(200);

    expect(db.requirementRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, extractedFields: FIELDS, changeSummary: "AI extraction", changedByRole: "SYSTEM" }),
    });
    const { where, data } = db.sponsorRequirement.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "req-1", version: 2, status: "DONOR_REVIEW" });
    expect(data.version).toBe(3);
    expect(data.versionNote).toBe("Donor corrected maximum budget");
    expect(data.extractedFields.budgetMax).toMatchObject({ value: 7500000, confidence: 1, source: "DONOR_CORRECTED", aiConfidence: 0.6 });
    expect(data.extractedFields.sector).toMatchObject({ confidence: 0.95, source: "AI_EXTRACTED" });
    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "REQUIREMENT_EDITED_BY_DONOR" }),
    });
  });

  it("does not let the donor edit once submitted for admin review", async () => {
    signIn(DONOR);
    db.sponsorRequirement.findUnique.mockResolvedValue(row({ status: "PENDING_ADMIN_REVIEW" }));
    const res = await putRequirement(put({ fields: { budgetMax: 1 } }), ctx);
    expect(res.status).toBe(400);
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
  });

  it("ignores client-supplied confidence and source", async () => {
    signIn(DONOR);
    await putRequirement(put({ extractedFields: { district: { value: "Barpeta", confidence: 0.01, source: "ADMIN_VERIFIED" } } }), ctx);
    const { data } = db.sponsorRequirement.updateMany.mock.calls[0][0];
    expect(data.extractedFields.district).toMatchObject({ value: "Barpeta", confidence: 1, source: "DONOR_CORRECTED" });
  });

  it("the owner submits for admin review; the status becomes PENDING_ADMIN_REVIEW, not VALIDATED", async () => {
    signIn(DONOR);
    const res = await submitReview(post(), ctx);
    expect(res.status).toBe(200);
    expect(db.sponsorRequirement.updateMany.mock.calls[0][0].data.status).toBe("PENDING_ADMIN_REVIEW");
  });

  it("an admin cannot submit on the donor's behalf", async () => {
    signIn(ADMIN);
    expect((await submitReview(post(), ctx)).status).toBe(403);
  });
});

describe("admin validation gate", () => {
  beforeEach(() => db.sponsorRequirement.findUnique.mockResolvedValue(row({ status: "PENDING_ADMIN_REVIEW" })));

  it("admin approval validates and verifies every field", async () => {
    signIn(ADMIN);
    const res = await adminApprove(post({ note: "Checked against the RFP" }), ctx);
    expect(res.status).toBe(200);
    const { data } = db.sponsorRequirement.updateMany.mock.calls[0][0];
    expect(data.status).toBe("VALIDATED");
    expect(data.reviewedById).toBe("admin-1");
    expect(Object.values(data.extractedFields).every((f: any) => f.source === "ADMIN_VERIFIED")).toBe(true);
    expect(db.adminActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "REQUIREMENT_VALIDATED", entityType: "REQUIREMENT", entityId: "req-1" }),
    });
  });

  it("admin can reject (reason required) and request correction", async () => {
    signIn(ADMIN);
    expect((await adminReject(post({}), ctx)).status).toBe(400);
    expect((await adminReject(post({ reason: "Not a CSR document" }), ctx)).status).toBe(200);
    expect(db.sponsorRequirement.updateMany.mock.calls[0][0].data).toMatchObject({ status: "REJECTED", reviewNote: "Not a CSR document" });

    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
    db.sponsorRequirement.updateMany.mockResolvedValue({ count: 1 });
    expect((await requestCorrection(post({ note: "Budget range is wrong" }), ctx)).status).toBe(200);
    expect(db.sponsorRequirement.updateMany.mock.calls[0][0].data.status).toBe("NEEDS_CORRECTION");
  });

  it.each([["the owning donor", DONOR], ["an NGO", NGO]])("%s cannot approve", async (_l, user) => {
    signIn(user);
    const res = await adminApprove(post(), ctx);
    expect(res.status).toBe(403);
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
  });

  it("an admin cannot skip donor submission", async () => {
    signIn(ADMIN);
    db.sponsorRequirement.findUnique.mockResolvedValue(row({ status: "DONOR_REVIEW" }));
    expect((await adminApprove(post(), ctx)).status).toBe(400);
  });

  it("turns a concurrent change into a 409 instead of a lost update", async () => {
    signIn(ADMIN);
    db.sponsorRequirement.updateMany.mockResolvedValue({ count: 0 });
    expect((await adminApprove(post(), ctx)).status).toBe(409);
  });
});

describe("gap analysis gate and authorization", () => {
  const gapCtx = { params: { requirementId: "req-1" } };

  it.each(["UPLOADED", "AI_EXTRACTED", "DONOR_REVIEW", "PENDING_ADMIN_REVIEW", "NEEDS_CORRECTION"])(
    "refuses to match a %s requirement",
    async (status) => {
      signIn(DONOR);
      db.sponsorRequirement.findUnique.mockResolvedValue(row({ status }));
      const res = await startGapAnalysis(post() as any, gapCtx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Matching can only be started after admin validation.");
      expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
    }
  );

  it("refuses another donor even for a validated requirement", async () => {
    signIn(OTHER_DONOR);
    db.sponsorRequirement.findUnique.mockResolvedValue(row({ status: "VALIDATED" }));
    expect((await startGapAnalysis(post() as any, gapCtx)).status).toBe(403);
  });

  it("matches a validated requirement against real project data and shortlists eligible candidates", async () => {
    signIn(DONOR);
    db.sponsorRequirement.findUnique
      .mockResolvedValueOnce(row({ status: "VALIDATED" }))
      .mockResolvedValueOnce(row({ status: "MATCHING" }))
      .mockResolvedValueOnce(row({ status: "SHORTLISTED" }));
    db.project.findMany.mockResolvedValue([
      {
        id: "proj-1",
        ngoId: "ngo-1",
        title: "Digital classrooms",
        causeCategory: "Education",
        stateName: "Assam",
        districtName: "Kamrup",
        location: "Kamrup, Assam",
        targetAmount: 8000000,
        createdAt: new Date("2026-01-01"),
        expected_outcome: null,
        problem_statement: null,
        milestones: [{ title: "Phase 1", description: "", deadline: new Date("2028-01-01") }],
        ngo: {
          orgName: "Assam Education Foundation",
          causeCategories: ["Education"],
          healthScore: 80,
          compliance: { fcraStatus: "NONE", fcraExpiryDate: null, eightyGVerified: true, a12Verified: true },
        },
      },
    ]);
    db.gapReport.create.mockResolvedValue({ id: "gap-1" });

    const res = await startGapAnalysis(post() as any, gapCtx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gapReportId: "gap-1", status: "SHORTLISTED", eligibleCount: 1 });

    const statuses = db.sponsorRequirement.updateMany.mock.calls.map((c: any) => c[0].data.status);
    expect(statuses).toEqual(["MATCHING", "SHORTLISTED"]);
    const [match] = db.requirementMatch.createMany.mock.calls[0][0].data;
    expect(match).toMatchObject({ projectId: "proj-1", eligible: true, rank: 1 });
    expect(match.dimensionScores.find((d: any) => d.dimension === "Sector").result).toBe("MATCH");
    // Projects don't record beneficiary targets → "insufficient data" with zero weight, not a fake score.
    const beneficiaries = match.dimensionScores.find((d: any) => d.dimension === "Beneficiaries");
    expect(beneficiaries).toMatchObject({ result: "INSUFFICIENT_DATA", weight: 0 });
  });

  const report = {
    id: "gap-1",
    reviewStatus: "PENDING",
    reviewNote: null,
    reviewedAt: null,
    createdAt: new Date(),
    algorithmVersion: "match-v2",
    candidateCount: 0,
    eligibleCount: 0,
    overallCompatibility: 0,
    sponsorRequirement: { id: "req-1", sponsorId: "donor-1", status: "SHORTLISTED" },
    matches: [],
  };
  const reportCtx = { params: { id: "gap-1" } };

  it.each([
    ["the owning donor", DONOR, 200],
    ["an admin", ADMIN, 200],
    ["another donor", OTHER_DONOR, 403],
    ["an NGO", NGO, 403],
  ])("gap report read by %s → %s", async (_l, user, status) => {
    signIn(user);
    db.gapReport.findUnique.mockResolvedValue(report);
    expect((await getReport(new Request("http://localhost") as any, reportCtx)).status).toBe(status);
  });

  it.each([["a donor", DONOR], ["an NGO", NGO]])("%s cannot approve or reject an analysis", async (_l, user) => {
    signIn(user);
    db.gapReport.findUnique.mockResolvedValue(report);
    const res = await putReport(put({ action: "approve" }) as any, reportCtx);
    expect(res.status).toBe(403);
    expect(db.gapReport.update).not.toHaveBeenCalled();
  });

  it("an admin approves an analysis; rejecting needs a note", async () => {
    signIn(ADMIN);
    db.gapReport.findUnique.mockResolvedValue(report);
    expect((await putReport(put({ action: "reject" }) as any, reportCtx)).status).toBe(400);
    expect((await putReport(put({ action: "approve" }) as any, reportCtx)).status).toBe(200);
    expect(db.gapReport.update).toHaveBeenCalledWith({
      where: { id: "gap-1" },
      data: expect.objectContaining({ reviewStatus: "APPROVED", reviewedBy: "admin-1" }),
    });
  });
});

describe("donor selection", () => {
  it("selects one NGO response and declines the rest", async () => {
    signIn(DONOR);
    db.sponsorRequirement.findUnique.mockResolvedValue(row({ status: "NGO_RESPONSE" }));
    db.opportunityResponse.findUnique.mockResolvedValue({
      id: "resp-1",
      requirementId: "req-1",
      projectId: "proj-9",
      ngoId: "ngo-9",
      status: "PROPOSAL_SUBMITTED",
      ngo: { orgName: "Rural Learning Trust", verificationStatus: "VERIFIED", isSuspended: false },
    });
    const res = await selectNgo(post({ responseId: "resp-1" }), ctx);
    expect(res.status).toBe(200);
    expect(db.sponsorRequirement.updateMany.mock.calls[0][0].data).toMatchObject({
      status: "SELECTED",
      selectedProjectId: "proj-9",
      selectedNgoId: "ngo-9",
    });
    expect(db.opportunityResponse.updateMany).toHaveBeenCalledWith({
      where: { requirementId: "req-1", id: { not: "resp-1" }, status: { not: "REJECTED" } },
      data: expect.objectContaining({ status: "REJECTED" }),
    });
  });

  it("cannot select before NGOs have responded", async () => {
    signIn(DONOR);
    db.sponsorRequirement.findUnique.mockResolvedValue(row({ status: "SHORTLISTED" }));
    db.opportunityResponse.findUnique.mockResolvedValue({
      id: "resp-1",
      requirementId: "req-1",
      projectId: "p",
      ngoId: "n",
      status: "INTERESTED",
      ngo: { orgName: "X", verificationStatus: "VERIFIED", isSuspended: false },
    });
    expect((await selectNgo(post({ responseId: "resp-1" }), ctx)).status).toBe(400);
  });
});
