import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What these tests protect.
 *
 * POST /api/gap-analysis/:requirementId had two defects that hid each other.
 *
 * 1. It handed the comparison engine the requirement's stored JSON, which is
 *    provenanced — every field is `{ value, confidence, source }`. The engine
 *    calls `.toLowerCase()` on the sector, so every run threw on the first
 *    dimension and came back 500. For everyone, admins included.
 * 2. It had no ownership check. Role proved the caller was *an* NGO; nothing
 *    proved the requirement was any of their business. Because of (1) nobody
 *    could demonstrate the leak, which is precisely why it survived.
 *
 * The REAL ComparisonEngine runs in these tests. Mocking it would have let
 * defect (1) back in without a single test turning red, since the mock would
 * happily accept the wrapped shape the real engine chokes on.
 */

const db = vi.hoisted(() => ({
  sponsorRequirement: { findUnique: vi.fn() },
  requirementMatch: { findFirst: vi.fn() },
  project: { findMany: vi.fn() },
  nGOCompliance: { findUnique: vi.fn() },
}));

const guard = vi.hoisted(() => ({ verifySessionRole: vi.fn() }));
const ai = vi.hoisted(() => ({ generateGapReport: vi.fn() }));
const repo = vi.hoisted(() => ({ saveReport: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth-guards", () => ({ verifySessionRole: guard.verifySessionRole }));

// Classes, not arrow functions: the route calls `new` on both of these, and an
// arrow function cannot be constructed.
vi.mock("@/src/agents/gap-diagnoser/services/ai-diagnoser", () => ({
  AIDiagnoserService: class {
    generateGapReport = ai.generateGapReport;
  },
}));
vi.mock("@/src/agents/gap-diagnoser/repositories/gap-repository", () => ({
  GapReportRepository: class {
    saveReport = repo.saveReport;
    getReport = vi.fn();
    updateReport = vi.fn();
  },
}));

import { POST } from "@/app/api/gap-analysis/[requirementId]/route";
import { toSponsorRequirementData } from "@/src/agents/gap-diagnoser/services/requirement-adapter";

const field = (value: unknown) => ({ value, confidence: 0.9, source: "AI_EXTRACTED" });

/** The provenanced shape as it is actually stored. */
const STORED_FIELDS = {
  summary: field("Computer labs for government schools."),
  sector: field("Education"),
  state: field("Maharashtra"),
  district: field("Pune"),
  budgetMin: field(500000),
  budgetMax: field(1500000),
  durationMonths: field(12),
  expectedBeneficiaries: field(2000),
  primaryKPIs: field(["students enrolled", "labs commissioned"]),
  reportingCadence: field("Quarterly"),
  requiredDocuments: field(["80G certificate", "12A registration"]),
  specialConstraints: field("Government schools only"),
};

function session(user: Record<string, unknown>) {
  return { authorized: true, response: null, session: { user } };
}

const NGO = { id: "ngo-user-1", role: "NGO", name: "Asha Trust", ngoProfileId: "ngo-1" };

const req = (url = "http://localhost/api/gap-analysis/req-1") => new Request(url, { method: "POST" });
const params = { params: { requirementId: "req-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  // Admin by default; the NGO cases override this.
  guard.verifySessionRole.mockResolvedValue(
    session({ id: "admin-1", role: "ADMIN", name: "Admin", ngoProfileId: null })
  );
  db.sponsorRequirement.findUnique.mockResolvedValue({ id: "req-1", extractedFields: STORED_FIELDS });
  db.project.findMany.mockResolvedValue([
    {
      id: "p1",
      ngoId: "ngo-1",
      causeCategory: "Education",
      stateName: "Maharashtra",
      districtName: "Pune",
      location: "Pune, Maharashtra",
      targetAmount: 2000000,
      description: "Digital literacy for 3000 students",
      problem_statement: "",
      expected_outcome: "labs commissioned",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      milestones: [{ deadline: new Date("2026-12-01T00:00:00.000Z") }],
    },
  ]);
  db.nGOCompliance.findUnique.mockResolvedValue({
    a12Verified: true,
    eightyGVerified: true,
    panVerified: true,
    registrationVerified: true,
    fcraStatus: "NONE",
  });
  db.requirementMatch.findFirst.mockResolvedValue({ id: "match-1" });
  ai.generateGapReport.mockResolvedValue({
    overallCompatibility: 82,
    gaps: [{ recommendation: "Add a second district" }],
  });
  repo.saveReport.mockResolvedValue({ id: "gap-1" });
});

describe("the stored field shape", () => {
  it("unwraps `{ value }` and translates the names the engine expects", () => {
    const flat = toSponsorRequirementData(STORED_FIELDS);

    expect(flat.sector).toBe("Education");
    expect(flat.state).toBe("Maharashtra");
    // Renamed, not just unwrapped.
    expect(flat.beneficiaries).toBe(2000);
    expect(flat.budget).toBe(1500000);
    expect(flat.kpis).toEqual(["students enrolled", "labs commissioned"]);
    // Derived from the document list through lib/requirements/facts.ts, so it
    // can be compared against verified compliance flags.
    expect(flat.requiredCertifications).toEqual(["12A", "80G"]);
    expect(flat.fcraRequired).toBe(false);
    expect(flat.specialConstraints).toEqual(["Government schools only"]);
  });

  it("survives a requirement with nothing extracted", () => {
    const flat = toSponsorRequirementData({});
    expect(flat.sector).toBeUndefined();
    expect(flat.budget).toBeUndefined();
    // Always answerable, so the dimension still renders.
    expect(flat.fcraRequired).toBe(false);
  });

  it("reads a number that came back from JSON as a string", () => {
    const flat = toSponsorRequirementData({
      budgetMax: field("1500000"),
      durationMonths: field("12"),
    });
    expect(flat.budget).toBe(1500000);
    expect(flat.durationMonths).toBe(12);
  });

  it("notices when the donor does demand FCRA", () => {
    const flat = toSponsorRequirementData({
      specialConstraints: field("FCRA registration is mandatory for this grant"),
    });
    expect(flat.fcraRequired).toBe(true);
  });
});

describe("POST /api/gap-analysis/:requirementId", () => {
  it("runs the real comparison and saves a report for an admin", async () => {
    const res = await POST(req(), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ gapReportId: "gap-1" });

    // The engine actually produced dimensions — proof the shape reached it in a
    // form it could read, rather than throwing on the first field.
    const comparison = ai.generateGapReport.mock.calls[0][0];
    expect(comparison.dimensions.length).toBeGreaterThan(0);
    const sector = comparison.dimensions.find((d: any) => d.dimension === "Sector");
    expect(sector).toBeDefined();
    expect(sector.sponsorValue).toBe("Education");
    expect(sector.status).toBe("MATCH");
  });

  it("refuses an NGO that was never invited, without calling the model", async () => {
    guard.verifySessionRole.mockResolvedValue(session(NGO));
    db.requirementMatch.findFirst.mockResolvedValue(null);

    const res = await POST(req(), params);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/not been invited/i),
    });
    expect(ai.generateGapReport).not.toHaveBeenCalled();
    expect(repo.saveReport).not.toHaveBeenCalled();
    // And no scan of anyone else's projects.
    expect(db.project.findMany).not.toHaveBeenCalled();
  });

  it("allows an NGO that was invited to this requirement", async () => {
    guard.verifySessionRole.mockResolvedValue(session(NGO));

    const res = await POST(req(), params);

    expect(res.status).toBe(200);
    // Scoped to the invitation for THIS requirement, not merely any invitation.
    expect(db.requirementMatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requirementId: "req-1",
          ngoId: "ngo-1",
          invitedAt: { not: null },
        }),
      })
    );
  });

  it("locks an NGO to its own profile even when it asks for another", async () => {
    guard.verifySessionRole.mockResolvedValue(session(NGO));

    await POST(req("http://localhost/api/gap-analysis/req-1?ngoId=someone-else"), params);

    expect(db.requirementMatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ngoId: "ngo-1" }) })
    );
    expect(db.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ngoId: "ngo-1" }) })
    );
  });

  it("does not require an invitation of an admin", async () => {
    db.requirementMatch.findFirst.mockResolvedValue(null);
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(db.requirementMatch.findFirst).not.toHaveBeenCalled();
  });

  it("404s a requirement that does not exist", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue(null);
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("refuses a donor outright", async () => {
    guard.verifySessionRole.mockResolvedValue(
      session({ id: "d1", role: "DONOR", ngoProfileId: null })
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(ai.generateGapReport).not.toHaveBeenCalled();
  });

  it("does not hand internal failure detail to the caller", async () => {
    ai.generateGapReport.mockRejectedValue(
      new Error('Invalid prisma.gapReport.create() invocation: column "foo" does not exist')
    );

    const res = await POST(req(), params);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Gap analysis failed");
    expect(JSON.stringify(body)).not.toMatch(/prisma|column/i);
  });
});
