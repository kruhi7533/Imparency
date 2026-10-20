import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Beneficiary/cohort minimum and "ready for matching" (roadmap row 7).
 * The matching profile has its own endpoint so saving it never sends a live
 * project back to approval; tenant isolation and role are pinned here.
 */

const db = vi.hoisted(() => ({
  project: { findUnique: vi.fn(), update: vi.fn() },
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { matchingReadiness } from "@/lib/project-readiness";
import {
  compareBeneficiaries,
  compareReporting,
  evaluateCandidate,
  type CandidateProject,
  type MatchRequirement,
} from "@/src/agents/gap-diagnoser/matchingEngine";
import { PATCH } from "@/app/api/ngo/projects/[id]/matching-profile/route";

const READY = {
  causeCategory: "Education",
  stateName: "Assam",
  expectedBeneficiaries: 500,
  beneficiaryGroup: "Girls aged 14–18 in government schools",
  durationMonths: 12,
};

describe("matchingReadiness", () => {
  it("is ready when cause, state, cohort size, cohort description and duration are all declared", () => {
    expect(matchingReadiness(READY)).toMatchObject({ ready: true, missing: [] });
  });

  it("a cohort of zero, or one with no description, is not the minimum", () => {
    expect(matchingReadiness({ ...READY, expectedBeneficiaries: 0 }).ready).toBe(false);
    expect(matchingReadiness({ ...READY, beneficiaryGroup: "   " }).missing).toEqual(["Who the beneficiaries are"]);
  });

  it("KPIs and reporting cadence are optional — they sharpen a match but never block readiness", () => {
    const r = matchingReadiness({ ...READY, primaryKPIs: [], reportingCadence: null });
    expect(r.ready).toBe(true);
    expect(r.items.filter((i) => !i.required).map((i) => i.done)).toEqual([false, false]);
  });

  it("an empty project lists every required item as missing", () => {
    const r = matchingReadiness({ causeCategory: null, stateName: null, expectedBeneficiaries: null, beneficiaryGroup: null, durationMonths: null });
    expect(r.missing).toHaveLength(5);
  });
});

const REQ: MatchRequirement = {
  sector: "Education",
  state: "Assam",
  district: null,
  budgetMin: null,
  budgetMax: null,
  durationMonths: null,
  expectedBeneficiaries: 1000,
  kpis: ["School attendance"],
  reportingCadence: "Quarterly",
  fcraRequired: false,
  requires80G: false,
  requires12A: false,
} as MatchRequirement;

const cand = (over: Partial<CandidateProject> = {}): CandidateProject => ({
  projectId: "p1",
  ngoId: "n1",
  ngoName: "Assam Education Foundation",
  projectTitle: "Digital classrooms",
  causeCategory: "Education",
  ngoCauseCategories: ["Education"],
  stateName: "Assam",
  districtName: null,
  location: "Assam",
  targetAmount: 8_000_000,
  durationMonths: 12,
  outcomeText: "",
  healthScore: 80,
  fcraStatus: "ACTIVE",
  eightyGVerified: true,
  twelveAVerified: true,
  ...over,
});

describe("compareBeneficiaries", () => {
  it("MATCH when the declared cohort meets the requirement, PARTIAL at half, MISMATCH below", () => {
    expect(compareBeneficiaries(REQ, cand({ expectedBeneficiaries: 1200 })).result).toBe("MATCH");
    expect(compareBeneficiaries(REQ, cand({ expectedBeneficiaries: 500 })).result).toBe("PARTIAL");
    expect(compareBeneficiaries(REQ, cand({ expectedBeneficiaries: 100 })).result).toBe("MISMATCH");
  });

  it("an undeclared cohort is INSUFFICIENT_DATA — never a match by default", () => {
    expect(compareBeneficiaries(REQ, cand()).result).toBe("INSUFFICIENT_DATA");
    expect(compareBeneficiaries(REQ, cand({ expectedBeneficiaries: 0 })).result).toBe("INSUFFICIENT_DATA");
  });

  it("the cohort description is shown beside the number", () => {
    expect(compareBeneficiaries(REQ, cand({ expectedBeneficiaries: 1200, beneficiaryGroup: "Girls 14–18" })).projectValue).toContain("Girls 14–18");
  });

  it("not applicable when the requirement names no number", () => {
    expect(compareBeneficiaries({ ...REQ, expectedBeneficiaries: null }, cand()).result).toBe("NOT_APPLICABLE");
  });
});

describe("compareReporting", () => {
  it("reporting more often than required is a MATCH, less often a MISMATCH", () => {
    expect(compareReporting(REQ, cand({ reportingCadence: "Monthly" })).result).toBe("MATCH");
    expect(compareReporting(REQ, cand({ reportingCadence: "Annually" })).result).toBe("MISMATCH");
  });

  it("understands the values the new-project form stores", () => {
    expect(compareReporting(REQ, cand({ reportingCadence: "MONTHLY" })).result).toBe("MATCH");
    expect(compareReporting({ ...REQ, reportingCadence: "Half-yearly" }, cand({ reportingCadence: "BI_ANNUAL" })).result).toBe("MATCH");
    expect(compareReporting(REQ, cand({ reportingCadence: "BI_ANNUAL" })).result).toBe("MISMATCH");
  });

  it("an incomparable cadence is PARTIAL (ask), an undeclared one INSUFFICIENT_DATA", () => {
    expect(compareReporting(REQ, cand({ reportingCadence: "At each milestone" })).result).toBe("PARTIAL");
    expect(compareReporting(REQ, cand()).result).toBe("INSUFFICIENT_DATA");
  });
});

describe("declared KPIs are compared before the outcome prose", () => {
  const kpi = (c: CandidateProject) => evaluateCandidate(REQ, c).dimensions.find((d) => d.dimension === "Outcome KPIs")!;

  it("a declared KPI matches even when the outcome prose is empty", () => {
    const d = kpi(cand({ primaryKPIs: ["Improved school attendance rate"] }));
    expect(d.result).toBe("MATCH");
    expect(d.explanation).toContain("declared KPIs");
  });

  it("with no declared KPIs the prose is still used", () => {
    const d = kpi(cand({ outcomeText: "Raise school attendance in Kamrup" }));
    expect(d.result).toBe("MATCH");
    expect(d.explanation).toContain("stated outcomes");
  });
});

describe("PATCH /api/ngo/projects/[id]/matching-profile", () => {
  const ctx = { params: { id: "proj-1" } };
  const req = (body: unknown) => new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
  const GOOD = { expectedBeneficiaries: "1,200", beneficiaryGroup: "  Girls 14–18  ", durationMonths: 12, primaryKPIs: ["Attendance", ""], reportingCadence: "Quarterly" };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "owner-a", role: "NGO" } });
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-a" });
    db.nGOTeamMember.findFirst.mockResolvedValue(null);
    db.project.findUnique.mockResolvedValue({ id: "proj-1", ngoId: "ngo-a", isDeleted: false });
    db.project.update.mockImplementation(async ({ data }: any) => ({ id: "proj-1", causeCategory: "Education", stateName: "Assam", ...data }));
  });

  it("the owner saves the cohort; nothing else (status, title, amount) is written", async () => {
    const res = await PATCH(req(GOOD), ctx);
    expect(res.status).toBe(200);
    const { data } = db.project.update.mock.calls[0][0];
    expect(data).toEqual({
      expectedBeneficiaries: 1200,
      beneficiaryGroup: "Girls 14–18",
      durationMonths: 12,
      primaryKPIs: ["Attendance"],
      reportingCadence: "Quarterly",
    });
    expect(data).not.toHaveProperty("status");
    expect((await res.json()).readiness.ready).toBe(true);
  });

  it("tenant isolation: org B's project is 403 and untouched", async () => {
    db.project.findUnique.mockResolvedValue({ id: "proj-1", ngoId: "ngo-b", isDeleted: false });
    expect((await PATCH(req(GOOD), ctx)).status).toBe(403);
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("field staff and finance members cannot edit it", async () => {
    db.nGOProfile.findUnique.mockResolvedValue(null);
    for (const role of ["FIELD_STAFF", "FINANCE"]) {
      db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-a", role });
      expect((await PATCH(req(GOOD), ctx)).status).toBe(403);
    }
    db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-a", role: "ADMIN" });
    expect((await PATCH(req(GOOD), ctx)).status).toBe(200);
  });

  it("a non-NGO session is refused before any lookup", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "d", role: "DONOR" } });
    expect((await PATCH(req(GOOD), ctx)).status).toBe(403);
    expect(db.project.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a zero cohort, a fractional duration, an over-long group and an unknown cadence", async () => {
    for (const bad of [
      { ...GOOD, expectedBeneficiaries: 0 },
      { ...GOOD, durationMonths: 1.5 },
      { ...GOOD, beneficiaryGroup: "x".repeat(201) },
      { ...GOOD, reportingCadence: "Whenever" },
      { ...GOOD, primaryKPIs: Array(11).fill("k") },
    ]) {
      expect((await PATCH(req(bad), ctx)).status).toBe(400);
    }
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("keeps a cadence saved by the new-project form (e.g. BI_ANNUAL)", async () => {
    expect((await PATCH(req({ ...GOOD, reportingCadence: "BI_ANNUAL" }), ctx)).status).toBe(200);
  });

  it("a deleted project is 404", async () => {
    db.project.findUnique.mockResolvedValue({ id: "proj-1", ngoId: "ngo-a", isDeleted: true });
    expect((await PATCH(req(GOOD), ctx)).status).toBe(404);
  });
});
