import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ADM-014 / NGO-016 / NGO-017 / NGO-018 / DON-013 / NEG-010 / E2E-005/006:
 * the baseline → endline improvement is computed from APPROVED-and-backed
 * figures only, is printed in percentage points for rates, and anything short
 * of that is the literal INSUFFICIENT_DATA — never 0, never invented.
 * Beneficiary feedback reaches donors only as consented aggregates.
 */

const db = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
const report = vi.hoisted(() => ({ loadNgoImpactReport: vi.fn() }));
vi.mock("@/lib/ngo-impact-report", () => report);

import { getServerSession } from "next-auth/next";
import { computeOutcomeChange, changesByMetric, formatChange, type ChangeInputRow } from "@/lib/outcome-change";
import { rollupByMetric, changesForProjects } from "@/lib/outcome-cockpit";
import { rollupFigure } from "@/lib/outcome-format";
import { donorFeedbackSummary, ngoFeedbackSummary, MIN_DONOR_COHORT, type FeedbackRow } from "@/lib/feedback-summary";
import { impactReportCsv } from "@/lib/donor-impact";
import { GET as NGO_REPORT } from "@/app/api/ngo/impact-report/route";

const verified = (value: string) => ({ kind: "verified" as const, value, unit: "PERCENTAGE" as const });
const unverified = { kind: "unverified" as const, reason: "This figure has not completed impact review." };

const row = (id: string, display: ChangeInputRow["display"], start: string, end: string, status: any = "APPROVED"): ChangeInputRow & { projectId: string } => ({
  id,
  projectId: "p1",
  metricCode: "IB-LITERACY-PCT-001",
  metricName: "Learners reading at grade level",
  unit: "PERCENTAGE",
  status,
  periodStart: start,
  periodEnd: end,
  display,
});

const BASELINE = row("c-base", verified("42.00"), "2026-01-01T00:00:00Z", "2026-03-31T00:00:00Z");
const ENDLINE = row("c-end", verified("61.00"), "2026-07-01T00:00:00Z", "2026-09-30T00:00:00Z");

describe("computeOutcomeChange", () => {
  it("baseline 42% → endline 61% is +19 pp, exact", () => {
    const c = computeOutcomeChange([ENDLINE, BASELINE])!;
    expect(c).toMatchObject({
      status: "COMPUTED",
      change: "19.00",
      changeUnit: "pp",
      label: "+19 pp",
      baseline: { claimId: "c-base", value: "42.00" },
      endline: { claimId: "c-end", value: "61.00" },
    });
  });

  it("an endline that is only SUBMITTED gives INSUFFICIENT_DATA, not +19 and not 0", () => {
    const pending = row("c-end", unverified, "2026-07-01T00:00:00Z", "2026-09-30T00:00:00Z", "SUBMITTED");
    const c = computeOutcomeChange([BASELINE, pending])!;
    expect(c.status).toBe("INSUFFICIENT_DATA");
    expect(c).not.toHaveProperty("change");
    expect((c as any).reason).toMatch(/not passed impact review/);
  });

  it("an approved figure whose evidence was withdrawn (display unverified) does not count", () => {
    const retracted = row("c-end", { kind: "unverified", reason: "The evidence behind this figure no longer supports it." }, "2026-07-01T00:00:00Z", "2026-09-30T00:00:00Z");
    expect(computeOutcomeChange([BASELINE, retracted])!.status).toBe("INSUFFICIENT_DATA");
  });

  it("nothing verified at all → INSUFFICIENT_DATA with a reason", () => {
    const c = computeOutcomeChange([row("a", unverified, "2026-01-01", "2026-02-01", "SUBMITTED")])!;
    expect(c).toMatchObject({ status: "INSUFFICIENT_DATA", verifiedCount: 0, excludedCount: 1 });
  });

  it("overlapping periods are not a before/after", () => {
    const overlap = row("c2", verified("61.00"), "2026-03-01T00:00:00Z", "2026-06-30T00:00:00Z");
    expect(computeOutcomeChange([BASELINE, overlap])!.status).toBe("INSUFFICIENT_DATA");
  });

  it("a decline is reported as a decline; no change is ±0, and counts use their unit", () => {
    expect(computeOutcomeChange([row("a", verified("61.00"), "2026-01-01", "2026-02-01"), row("b", verified("42.50"), "2026-03-01", "2026-04-01")])!).toMatchObject({ change: "-18.50", label: "-18.5 pp" });
    expect(formatChange("0.00", "PERCENTAGE")).toBe("±0 pp");
    expect(formatChange("120.00", "COUNT_PEOPLE")).toBe("+120 people");
  });

  it("groups by metric and by project", () => {
    expect(changesByMetric([BASELINE, ENDLINE])).toHaveLength(1);
    const other = { ...ENDLINE, projectId: "p2", id: "x" };
    const out = changesForProjects([BASELINE, ENDLINE, other]);
    expect(out.find((c) => c.projectId === "p1")!.status).toBe("COMPUTED");
    expect(out.find((c) => c.projectId === "p2")!.status).toBe("INSUFFICIENT_DATA");
  });

  it("drafts and rejected claims are never part of the change", () => {
    const draft = row("d", verified("99.00"), "2026-10-01", "2026-10-31", "DRAFT");
    const out = changesForProjects([BASELINE, ENDLINE, draft]);
    expect(out[0]).toMatchObject({ status: "COMPUTED", label: "+19 pp" });
  });
});

describe("rollup of a percentage metric", () => {
  it("never sums rates (42 + 61 is not 103%); shows the latest verified figure instead", () => {
    const [m] = rollupByMetric([BASELINE, ENDLINE]);
    expect(m.summable).toBe(false);
    expect(m.verifiedTotal).toBeNull();
    expect(m.latestVerified).toMatchObject({ value: "61.00" });
    expect(rollupFigure(m)).toBe("61 % (latest)");
  });

  it("aggregatable=false in the registry also stops a sum", () => {
    const [m] = rollupByMetric([{ ...BASELINE, unit: "COUNT_ITEMS", display: { kind: "verified", value: "5", unit: "COUNT_ITEMS" }, aggregatable: false }]);
    expect(m.verifiedTotal).toBeNull();
  });

  it("nothing verified renders as null (the UI prints Unverified), never 0", () => {
    const [m] = rollupByMetric([row("a", unverified, "2026-01-01", "2026-02-01", "SUBMITTED")]);
    expect(rollupFigure(m)).toBeNull();
  });
});

describe("donor CSV", () => {
  const project = (changes: any[]) => ({
    generatedAt: "",
    portfolio: [],
    projects: [
      {
        projectId: "p1", title: "Reading", ngoName: "Akshar", location: null, causeCategory: null, fundedAt: null, contracts: [],
        contribution: { contractCommitted: "0.00", contractReconciled: "0.00", donated: "0.00" },
        milestones: { total: 0, verified: 0 },
        outcomes: [],
        changes,
        beneficiaryFeedback: { status: "INSUFFICIENT_DATA", reason: "x" },
      },
    ],
  });

  it("exports a computed change with its unit and the figures it came from", () => {
    const csv = impactReportCsv(project(changesByMetric([BASELINE, ENDLINE])) as any);
    expect(csv).toContain("Learners reading at grade level,19.00,pp,2026-01-01,2026-09-30,verified,baseline_to_endline_change,baseline 42.00 -> endline 61.00");
  });

  it("exports the literal INSUFFICIENT_DATA when the evidence is missing — never 0 or blank", () => {
    const pending = row("c-end", unverified, "2026-07-01T00:00:00Z", "2026-09-30T00:00:00Z", "SUBMITTED");
    const csv = impactReportCsv(project(changesByMetric([BASELINE, pending])) as any);
    const line = csv.split("\n").find((l) => l.includes("baseline_to_endline_change"))!;
    expect(line).toContain(",INSUFFICIENT_DATA,PERCENTAGE,,,INSUFFICIENT_DATA,");
    expect(line).not.toMatch(/,0(\.00)?,/);
  });
});

describe("beneficiary feedback aggregation (NGO-018)", () => {
  const fb = (i: number, over: Partial<FeedbackRow> = {}): FeedbackRow => ({
    projectId: "p1",
    beneficiaryRef: `HH-${i}`,
    consentToRecord: true,
    withdrawnAt: null,
    rating: 4,
    feedbackText: `comment ${i}`,
    capturedAt: new Date(2026, 9, i + 1),
    ...over,
  });

  it("NGO view counts refusals and withdrawals; ratings/comments use consented, not-withdrawn rows only", () => {
    const rows = [fb(1, { rating: 5 }), fb(2, { rating: 3 }), fb(3, { consentToRecord: false, rating: null, feedbackText: null }), fb(4, { withdrawnAt: new Date(), rating: 1 })];
    const s = ngoFeedbackSummary(rows);
    expect(s).toMatchObject({ captured: 4, consented: 2, refused: 1, withdrawn: 1, rated: 2, averageRating: "4.0" });
    expect(s.comments.map((c) => c.text)).toEqual(["comment 2", "comment 1"]);
  });

  it("donor view is suppressed below the cohort minimum (INSUFFICIENT_DATA, not 0)", () => {
    const s = donorFeedbackSummary(Array.from({ length: MIN_DONOR_COHORT - 1 }, (_, i) => fb(i)));
    expect(s.status).toBe("INSUFFICIENT_DATA");
  });

  it("donor view carries aggregates only — no references, no comments — and ignores withdrawn people", () => {
    const rows = [...Array.from({ length: MIN_DONOR_COHORT }, (_, i) => fb(i, { rating: 4 })), fb(99, { withdrawnAt: new Date(), rating: 1 })];
    const s = donorFeedbackSummary(rows);
    expect(s).toMatchObject({ status: "AVAILABLE", respondents: MIN_DONOR_COHORT, averageRating: "4.0" });
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/HH-|comment/);
  });
});

describe("GET /api/ngo/impact-report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only an NGO; scoped to the caller's own organisation", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "donor-1", role: "DONOR" } });
    expect((await NGO_REPORT()).status).toBe(403);

    (getServerSession as any).mockResolvedValue({ user: { id: "u-field", role: "NGO" } });
    db.nGOProfile.findUnique.mockResolvedValue(null);
    db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-a", role: "FIELD_STAFF" });
    report.loadNgoImpactReport.mockResolvedValue({ projects: [] });
    const res = await NGO_REPORT();
    expect(res.status).toBe(200);
    expect(report.loadNgoImpactReport).toHaveBeenCalledWith("ngo-a");
  });

  it("an NGO user with no membership gets 403", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "u-x", role: "NGO" } });
    db.nGOProfile.findUnique.mockResolvedValue(null);
    db.nGOTeamMember.findFirst.mockResolvedValue(null);
    expect((await NGO_REPORT()).status).toBe(403);
    expect(report.loadNgoImpactReport).not.toHaveBeenCalled();
  });
});
