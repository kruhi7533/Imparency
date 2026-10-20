import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The donor's cross-project impact report. Scope (only this donor's signed
 * contracts and successful donations), the display contract (unverified is
 * never 0, in the page model or the CSV), and that the donor's own money is
 * counted from RECONCILED payments only.
 */

const db = vi.hoisted(() => ({
  donorTeamMember: { findUnique: vi.fn() },
  contract: { findMany: vi.fn() },
  donation: { groupBy: vi.fn() },
  project: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

const outcomes = vi.hoisted(() => ({ loadDonorProjectOutcomes: vi.fn() }));
vi.mock("@/lib/outcome-cockpit", async (orig) => ({ ...(await orig<any>()), loadDonorProjectOutcomes: outcomes.loadDonorProjectOutcomes }));

import { getServerSession } from "next-auth/next";
import { impactReportCsv, loadDonorImpact } from "@/lib/donor-impact";
import { GET } from "@/app/api/donor/impact-report/route";

const verified = { kind: "verified", value: "1200", unit: "COUNT_PEOPLE" };
const unverified = { kind: "unverified", reason: "This figure has not completed impact review." };
const row = (id: string, display: any, status = "APPROVED") => ({
  id,
  metricCode: "STUDENTS_REACHED",
  metricName: "Students reached",
  definition: "",
  unit: "COUNT_PEOPLE",
  status,
  periodStart: "2026-04-01T00:00:00.000Z",
  periodEnd: "2026-09-30T00:00:00.000Z",
  display,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.contract.findMany.mockResolvedValue([
    {
      id: "c-1",
      title: "CSR grant",
      projectId: "proj-a",
      status: "ACTIVE",
      totalGrantAmount: 100000,
      payments: [
        { amount: 60000, status: "RECONCILED" },
        { amount: 40000, status: "PENDING_CONFIRMATION" },
      ],
    },
  ]);
  db.donation.groupBy.mockResolvedValue([{ projectId: "proj-b", _sum: { amount: 2500 } }]);
  db.project.findMany.mockResolvedValue([
    { id: "proj-a", title: "Digital classrooms", location: "Assam", causeCategory: "Education", fundedAt: null, ngo: { orgName: "Akshar" }, milestones: [{ status: "VERIFIED" }, { status: "PENDING" }] },
    { id: "proj-b", title: "Literacy kits", location: null, causeCategory: "Education", fundedAt: null, ngo: { orgName: "Akshar" }, milestones: [] },
  ]);
  outcomes.loadDonorProjectOutcomes.mockImplementation(async (id: string) => ({
    rows: id === "proj-a" ? [row("o-1", verified), row("o-2", unverified, "SUBMITTED")] : [],
    rollup: [],
  }));
});

describe("loadDonorImpact", () => {
  it("is scoped to this donor's signed contracts and successful donations", async () => {
    await loadDonorImpact("donor-1");
    expect(db.contract.findMany.mock.calls[0][0].where).toEqual({ donorId: "donor-1", status: { in: ["ACTIVE", "COMPLETED"] } });
    expect(db.donation.groupBy.mock.calls[0][0].where).toEqual({ donorId: "donor-1", status: "SUCCESS" });
    expect(db.project.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(["proj-a", "proj-b"]);
  });

  it("the donor's money: committed from signed contracts, received from RECONCILED payments only", async () => {
    const r = await loadDonorImpact("donor-1");
    const a = r.projects.find((p) => p.projectId === "proj-a")!;
    expect(a.contribution).toEqual({ contractCommitted: "100000.00", contractReconciled: "60000.00", donated: "0.00" });
    expect(r.projects.find((p) => p.projectId === "proj-b")!.contribution.donated).toBe("2500.00");
    expect(a.milestones).toEqual({ total: 2, verified: 1 });
  });

  it("the portfolio rollup counts verified figures only; unverified ones are reported, not summed", async () => {
    const r = await loadDonorImpact("donor-1");
    expect(r.portfolio).toHaveLength(1);
    expect(r.portfolio[0]).toMatchObject({ metricCode: "STUDENTS_REACHED", verifiedTotal: "1200.00", verifiedCount: 1, inReviewCount: 1 });
  });

  it("a donor funding nothing gets an empty report, not an error", async () => {
    db.contract.findMany.mockResolvedValue([]);
    db.donation.groupBy.mockResolvedValue([]);
    expect(await loadDonorImpact("donor-1")).toMatchObject({ projects: [], portfolio: [] });
    expect(db.project.findMany).not.toHaveBeenCalled();
  });
});

describe("impactReportCsv", () => {
  it("exports an unverified figure as the word 'unverified', never blank or 0", async () => {
    const csv = impactReportCsv(await loadDonorImpact("donor-1"));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("project,organisation,metric,value,unit,period_start,period_end,status");
    expect(lines[1]).toBe("Digital classrooms,Akshar,Students reached,1200,COUNT_PEOPLE,2026-04-01,2026-09-30,verified");
    expect(lines[2]).toContain(",unverified,COUNT_PEOPLE,");
    expect(lines[2]).not.toMatch(/,0,/);
  });

  it("escapes commas and quotes", async () => {
    db.project.findMany.mockResolvedValue([
      { id: "proj-a", title: 'Classrooms, "phase 2"', location: null, causeCategory: null, fundedAt: null, ngo: { orgName: "Akshar" }, milestones: [] },
    ]);
    const csv = impactReportCsv(await loadDonorImpact("donor-1"));
    expect(csv).toContain('"Classrooms, ""phase 2"""');
  });
});

describe("GET /api/donor/impact-report", () => {
  it("only a donor can download it, and it is their own", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "ngo-user", role: "NGO" } });
    expect((await GET()).status).toBe(403);
    (getServerSession as any).mockResolvedValue({ user: { id: "donor-1", role: "DONOR" } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(db.contract.findMany.mock.calls.at(-1)![0].where.donorId).toBe("donor-1");
  });
});
