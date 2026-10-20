import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * NGO impact cockpit + donor outcome view (Week 8, NGO track).
 *
 *  - roll-ups are exact and never cross metrics
 *  - donors see a figure only when APPROVED and still backed; otherwise
 *    "unverified" with a reason — never 0 (claimDisplay contract)
 *  - claims are editable only in DRAFT / NEEDS_EVIDENCE, by their own NGO,
 *    citing only its own evidence; a concurrent change wins cleanly
 *  - the pre-submit check reports the evidence upper bound
 */

const db = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn() },
  outcomeClaim: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  outcomeClaimEvidence: { deleteMany: vi.fn(), createMany: vi.fn() },
  metricDefinition: { findUnique: vi.fn() },
  milestoneProof: { findMany: vi.fn() },
  fieldEvidence: { findMany: vi.fn() },
  beneficiaryFeedback: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const evidence = vi.hoisted(() => ({ resolveCitations: vi.fn(), evidenceAlreadyCounted: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/outcome-evidence", () => evidence);
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { rollupByMetric, loadDonorProjectOutcomes } from "@/lib/outcome-cockpit";
import { PUT as editClaim } from "@/app/api/ngo/outcome-claims/[id]/route";
import { POST as previewClaim } from "@/app/api/ngo/outcome-claims/preview/route";

const signIn = (user: { id: string; role: string } | null) => {
  (getServerSession as any).mockResolvedValue(user ? { user } : null);
};
const json = (body: unknown, method = "PUT") => new Request("http://localhost", { method, body: JSON.stringify(body) });

const PEOPLE_METRIC = { code: "IB-PEOPLE-TRAINED-001", unit: "COUNT_PEOPLE", status: "ACTIVE", requiredEvidence: ["BENEFICIARY_FEEDBACK"] };
const approvedFeedback = (id: string, over: Record<string, unknown> = {}) => ({
  citationId: `c-${id}`,
  kind: "BENEFICIARY_FEEDBACK",
  evidenceRef: id,
  approved: true,
  duplicateVerdict: "UNIQUE",
  capturedAt: new Date("2026-09-15"),
  consentToRecord: true,
  consentWithdrawn: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-1" });
  evidence.evidenceAlreadyCounted.mockResolvedValue(new Set());
  db.milestoneProof.findMany.mockResolvedValue([]);
  db.fieldEvidence.findMany.mockResolvedValue([]);
  db.beneficiaryFeedback.findMany.mockResolvedValue([]);
});

describe("rollupByMetric", () => {
  const verified = (value: string) => ({ kind: "verified" as const, value, unit: "COUNT_ITEMS" as const });
  const unverified = { kind: "unverified" as const, reason: "x" };

  it("sums verified figures exactly, per metric, and never across metrics", () => {
    const r = rollupByMetric([
      { metricCode: "A", metricName: "Meals", unit: "COUNT_ITEMS", status: "APPROVED", display: verified("0.10") },
      { metricCode: "A", metricName: "Meals", unit: "COUNT_ITEMS", status: "APPROVED", display: verified("0.20") },
      { metricCode: "B", metricName: "Trained", unit: "COUNT_PEOPLE", status: "APPROVED", display: verified("40") },
    ]);
    expect(r.find((m) => m.metricCode === "A")).toMatchObject({ verifiedTotal: "0.30", verifiedCount: 2 });
    expect(r.find((m) => m.metricCode === "B")).toMatchObject({ verifiedTotal: "40.00", verifiedCount: 1 });
  });

  it("counts an approved-but-unbacked figure separately and never adds it to the total", () => {
    const [m] = rollupByMetric([
      { metricCode: "A", metricName: "Meals", unit: "COUNT_ITEMS", status: "APPROVED", display: unverified },
      { metricCode: "A", metricName: "Meals", unit: "COUNT_ITEMS", status: "SUBMITTED", display: unverified },
      { metricCode: "A", metricName: "Meals", unit: "COUNT_ITEMS", status: "DRAFT", display: unverified },
    ]);
    expect(m).toMatchObject({ verifiedTotal: "0.00", verifiedCount: 0, unverifiedApprovedCount: 1, inReviewCount: 1, draftCount: 1 });
  });
});

describe("donor view of a funded project's outcomes", () => {
  const claim = (id: string, status: string, citations: any[]) => ({
    id,
    metricCode: PEOPLE_METRIC.code,
    value: { toString: () => "3" },
    unit: "COUNT_PEOPLE",
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-30"),
    status,
    metric: { ...PEOPLE_METRIC, name: "People trained", definition: "def" },
    citations,
  });

  it("queries only asserted claims (never drafts, rejected or withdrawn)", async () => {
    db.outcomeClaim.findMany.mockResolvedValue([]);
    await loadDonorProjectOutcomes("p-1");
    expect(db.outcomeClaim.findMany.mock.calls[0][0].where).toEqual({ projectId: "p-1", status: { in: ["SUBMITTED", "NEEDS_EVIDENCE", "APPROVED"] } });
  });

  it("shows an approved, backed figure; an approved claim whose evidence no longer supports it reads unverified, never 0", async () => {
    db.outcomeClaim.findMany.mockResolvedValue([claim("backed", "APPROVED", [{}]), claim("unbacked", "APPROVED", [{}])]);
    evidence.resolveCitations
      .mockResolvedValueOnce([approvedFeedback("f1"), approvedFeedback("f2"), approvedFeedback("f3")])
      // Its evidence is no longer approved — EVIDENCE_NOT_APPROVED, a BLOCK.
      .mockResolvedValueOnce([approvedFeedback("f4", { approved: false })]);
    const { rows, rollup } = await loadDonorProjectOutcomes("p-1");
    expect(rows.find((r) => r.id === "backed")?.display).toEqual({ kind: "verified", value: "3", unit: "COUNT_PEOPLE" });
    const unbacked = rows.find((r) => r.id === "unbacked")!.display;
    expect(unbacked.kind).toBe("unverified");
    expect(JSON.stringify(unbacked)).not.toMatch(/"value":"0/);
    expect(rollup[0]).toMatchObject({ verifiedTotal: "3.00", verifiedCount: 1, unverifiedApprovedCount: 1 });
  });

  it("a claim in review is unverified, and a triage that cannot run is unverified rather than fine", async () => {
    db.outcomeClaim.findMany.mockResolvedValue([claim("review", "SUBMITTED", [{}]), claim("broken", "APPROVED", [{}])]);
    evidence.resolveCitations.mockResolvedValueOnce([approvedFeedback("f1")]).mockRejectedValueOnce(new Error("db down"));
    const { rows } = await loadDonorProjectOutcomes("p-1");
    expect(rows.every((r) => r.display.kind === "unverified")).toBe(true);
  });
});

describe("PUT /api/ngo/outcome-claims/[id] — edit", () => {
  const ctx = { params: { id: "claim-1" } };
  const body = {
    value: "40",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    method: "Counted from signed attendance sheets",
    citations: [{ kind: "BENEFICIARY_FEEDBACK", id: "f1" }],
  };

  beforeEach(() => {
    signIn({ id: "ngo-user-1", role: "NGO" });
    db.outcomeClaim.findUnique.mockResolvedValue({ id: "claim-1", ngoId: "ngo-1", status: "NEEDS_EVIDENCE" });
    db.beneficiaryFeedback.findMany.mockResolvedValue([{ id: "f1", ngoId: "ngo-1" }]);
    db.outcomeClaim.updateMany.mockResolvedValue({ count: 1 });
  });

  it("edits a claim returned for evidence and replaces its citations, guarded on the status read", async () => {
    const res = await editClaim(json(body), ctx);
    expect(res.status).toBe(200);
    expect(db.outcomeClaim.updateMany).toHaveBeenCalledWith({
      where: { id: "claim-1", status: "NEEDS_EVIDENCE" },
      data: expect.objectContaining({ value: "40", method: "Counted from signed attendance sheets" }),
    });
    expect(db.outcomeClaimEvidence.deleteMany).toHaveBeenCalledWith({ where: { claimId: "claim-1" } });
    expect(db.outcomeClaimEvidence.createMany).toHaveBeenCalledWith({ data: [{ kind: "BENEFICIARY_FEEDBACK", feedbackId: "f1", claimId: "claim-1" }] });
  });

  it("a submitted or approved claim cannot be edited (409) — a reviewer or funder may be looking at it", async () => {
    for (const status of ["SUBMITTED", "APPROVED", "WITHDRAWN"]) {
      db.outcomeClaim.findUnique.mockResolvedValue({ id: "claim-1", ngoId: "ngo-1", status });
      expect((await editClaim(json(body), ctx)).status).toBe(409);
    }
    expect(db.outcomeClaim.updateMany).not.toHaveBeenCalled();
  });

  it("tenant isolation: another organisation's claim is a 404; citing another organisation's evidence is a 403", async () => {
    db.outcomeClaim.findUnique.mockResolvedValue({ id: "claim-1", ngoId: "ngo-2", status: "DRAFT" });
    expect((await editClaim(json(body), ctx)).status).toBe(404);

    db.outcomeClaim.findUnique.mockResolvedValue({ id: "claim-1", ngoId: "ngo-1", status: "DRAFT" });
    db.beneficiaryFeedback.findMany.mockResolvedValue([{ id: "f1", ngoId: "ngo-2" }]);
    expect((await editClaim(json(body), ctx)).status).toBe(403);
    expect(db.outcomeClaim.updateMany).not.toHaveBeenCalled();
  });

  it("a concurrent submit wins: the edit returns 409 and touches no citations", async () => {
    db.outcomeClaim.updateMany.mockResolvedValue({ count: 0 });
    expect((await editClaim(json(body), ctx)).status).toBe(409);
    expect(db.outcomeClaimEvidence.deleteMany).not.toHaveBeenCalled();
  });

  it("validates value, period and method", async () => {
    for (const bad of [{ value: "-1" }, { value: "1.234" }, { periodEnd: "2026-08-01" }, { method: "short" }]) {
      expect((await editClaim(json({ ...body, ...bad }), ctx)).status).toBe(400);
    }
  });

  it("only NGO sessions may edit", async () => {
    signIn({ id: "donor-1", role: "DONOR" });
    expect((await editClaim(json(body), ctx)).status).toBe(403);
  });
});

describe("POST /api/ngo/outcome-claims/preview — the pre-submit check", () => {
  const body = {
    metricCode: PEOPLE_METRIC.code,
    value: "5",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    citations: [
      { kind: "BENEFICIARY_FEEDBACK", id: "f1" },
      { kind: "BENEFICIARY_FEEDBACK", id: "f2" },
    ],
  };

  beforeEach(() => {
    signIn({ id: "ngo-user-1", role: "NGO" });
    db.metricDefinition.findUnique.mockResolvedValue(PEOPLE_METRIC);
    db.beneficiaryFeedback.findMany.mockResolvedValue([{ id: "f1", ngoId: "ngo-1" }, { id: "f2", ngoId: "ngo-1" }]);
    evidence.resolveCitations.mockResolvedValue([approvedFeedback("f1"), approvedFeedback("f2")]);
  });

  it("reports the evidence upper bound and the verdict the reviewer's gate would apply, without writing anything", async () => {
    const res = await previewClaim(json(body, "POST"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.upperBound).toBe(2);
    expect(data.approvedCitations).toBe(2);
    // 5 people claimed on 2 consented records: the triage says so.
    expect(data.triage.verdict).not.toBe("CLEAN");
    expect(db.outcomeClaim.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to preview against another organisation's evidence (403)", async () => {
    db.beneficiaryFeedback.findMany.mockResolvedValue([{ id: "f1", ngoId: "ngo-2" }, { id: "f2", ngoId: "ngo-1" }]);
    expect((await previewClaim(json(body, "POST"))).status).toBe(403);
  });
});
