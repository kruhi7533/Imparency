import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * NGO-017 — stored contract impact reports.
 *  - built only from APPROVED outcome claims (pinned at submission);
 *  - state machine DRAFT → SUBMITTED → PUBLISHED (admin) / RETURNED (admin + note);
 *  - tenant isolation on every NGO route;
 *  - figures rendered through claimDisplay (unverified never 0).
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    contract: { findUnique: vi.fn() },
    contractImpactReport: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    renewalRequest: { findMany: vi.fn() },
    outcomeClaim: { findMany: vi.fn() },
    notification: { create: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
// Triage is workstream B's; here it is a fixed verdict so the read contract is what is tested.
vi.mock("@/lib/outcome-cockpit", () => ({ triageClaim: vi.fn(async () => ({ verdict: "CLEAN", findings: [] })) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { triageClaim } from "@/lib/outcome-cockpit";
import { reportTransition, reportableClaimIds, parseReportInput, loadReportFigures } from "@/lib/contract-impact-reports";
import { POST as _CREATE } from "@/app/api/ngo/impact-reports/route";
import { PATCH as _NGO_PATCH } from "@/app/api/ngo/impact-reports/[id]/route";
import { PATCH as _ADMIN_PATCH } from "@/app/api/admin/impact-reports/[id]/route";

// Handlers are typed with the auth guard's nullable response; every path under test returns one.
const CREATE = _CREATE as (...a: any[]) => Promise<Response>;
const NGO_PATCH = _NGO_PATCH as (...a: any[]) => Promise<Response>;
const ADMIN_PATCH = _ADMIN_PATCH as (...a: any[]) => Promise<Response>;

const db = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const json = (body: unknown, method = "POST") => new Request("http://t", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const claim = (id: string, status: string) => ({
  id,
  metricCode: "PEOPLE_TRAINED",
  value: { toString: () => "120" },
  unit: "PEOPLE",
  periodStart: new Date("2026-07-01"),
  periodEnd: new Date("2026-09-30"),
  status,
  metric: { code: "PEOPLE_TRAINED", name: "People trained", unit: "PEOPLE", status: "ACTIVE", requiredEvidence: ["FIELD_EVIDENCE"] },
  citations: [],
});

const draft = { id: "rep-1", contractId: "c-1", ngoId: "ngo-a", donorId: "donor-1", projectId: "p-1", title: "Q3", summary: "", status: "DRAFT", claimIds: [], periodStart: new Date("2026-07-01"), periodEnd: new Date("2026-09-30"), createdAt: new Date(), submittedAt: null, publishedAt: null, reviewNote: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.nGOProfile.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-a" ? { id: "ngo-a" } : where.userId === "u-b" ? { id: "ngo-b" } : where.id ? { userId: "u-a" } : null),
  );
  db.nGOTeamMember.findFirst.mockImplementation(({ where }: any) => Promise.resolve(where.userId === "u-field" ? { ngoId: "ngo-a", role: "FIELD_STAFF" } : null));
  db.contract.findUnique.mockResolvedValue({ id: "c-1", ngoId: "ngo-a", donorId: "donor-1", projectId: "p-1", status: "ACTIVE" });
  db.contractImpactReport.create.mockImplementation(({ data }: any) => Promise.resolve({ ...draft, ...data, id: "rep-new" }));
  db.contractImpactReport.findUnique.mockResolvedValue(draft);
  db.contractImpactReport.updateMany.mockResolvedValue({ count: 1 });
});

describe("report state machine", () => {
  it("lets the NGO submit a draft or a returned report, nothing else", () => {
    expect(reportTransition("SUBMIT", "DRAFT", "NGO")).toEqual({ ok: true, to: "SUBMITTED" });
    expect(reportTransition("SUBMIT", "RETURNED", "NGO")).toEqual({ ok: true, to: "SUBMITTED" });
    expect(reportTransition("SUBMIT", "PUBLISHED", "NGO")).toMatchObject({ ok: false, status: 409 });
  });
  it("publishing is an admin-only gate", () => {
    expect(reportTransition("PUBLISH", "SUBMITTED", "NGO")).toMatchObject({ ok: false, status: 403 });
    expect(reportTransition("PUBLISH", "SUBMITTED", "ADMIN")).toEqual({ ok: true, to: "PUBLISHED" });
    expect(reportTransition("PUBLISH", "DRAFT", "ADMIN")).toMatchObject({ ok: false, status: 409 });
  });
  it("pins only APPROVED claims", () => {
    expect(reportableClaimIds([{ id: "a", status: "APPROVED" }, { id: "b", status: "SUBMITTED" }, { id: "c", status: "NEEDS_EVIDENCE" }] as any)).toEqual(["a"]);
  });
  it("rejects an inverted period", () => {
    expect(parseReportInput({ title: "x", periodStart: "2026-10-01", periodEnd: "2026-09-01" })).toMatchObject({ ok: false });
  });
});

describe("figures go through claimDisplay", () => {
  it("renders a pinned claim whose evidence now fails as 'unverified', never 0", async () => {
    db.outcomeClaim.findMany.mockResolvedValue([claim("cl-1", "APPROVED")]);
    (triageClaim as any).mockResolvedValueOnce({ verdict: "BLOCKED", findings: [] });
    const { figures } = await loadReportFigures({ ...draft, status: "PUBLISHED", claimIds: ["cl-1"] } as any);
    expect(figures[0].display).toMatchObject({ kind: "unverified" });
    expect(JSON.stringify(figures)).not.toContain('"value":"0"');
  });
  it("a draft previews approved claims as figures and keeps in-review ones out", async () => {
    db.outcomeClaim.findMany.mockResolvedValue([claim("cl-1", "APPROVED"), claim("cl-2", "SUBMITTED")]);
    const r = await loadReportFigures(draft as any);
    expect(r.figures.map((f) => f.claimId)).toEqual(["cl-1"]);
    expect(r.figures[0].display).toMatchObject({ kind: "verified", value: "120" });
    expect(r.pendingNotIncluded[0].display.kind).toBe("unverified");
  });
});

describe("NGO routes", () => {
  it("creates a DRAFT on its own ACTIVE contract", async () => {
    session("u-a", "NGO");
    const res = await CREATE(json({ contractId: "c-1", title: "Q3 report", periodStart: "2026-07-01", periodEnd: "2026-09-30" }));
    expect(res.status).toBe(201);
    expect(db.contractImpactReport.create.mock.calls[0][0].data).toMatchObject({ ngoId: "ngo-a", donorId: "donor-1", projectId: "p-1", claimIds: [] });
  });
  it("isolation: org B gets 403 on org A's contract and writes nothing", async () => {
    session("u-b", "NGO");
    const res = await CREATE(json({ contractId: "c-1", title: "x", periodStart: "2026-07-01", periodEnd: "2026-09-30" }));
    expect(res.status).toBe(403);
    expect(db.contractImpactReport.create).not.toHaveBeenCalled();
  });
  it("field staff cannot write funder reports", async () => {
    session("u-field", "NGO");
    expect((await CREATE(json({ contractId: "c-1", title: "x", periodStart: "2026-07-01", periodEnd: "2026-09-30" }))).status).toBe(403);
  });
  it("isolation: org B cannot submit org A's report", async () => {
    session("u-b", "NGO");
    const res = await NGO_PATCH(json({ action: "SUBMIT" }, "PATCH"), { params: { id: "rep-1" } });
    expect(res.status).toBe(403);
    expect(db.contractImpactReport.updateMany).not.toHaveBeenCalled();
  });
  it("refuses to submit with no approved claims in the period (422)", async () => {
    session("u-a", "NGO");
    db.outcomeClaim.findMany.mockResolvedValue([claim("cl-2", "SUBMITTED")]);
    const res = await NGO_PATCH(json({ action: "SUBMIT" }, "PATCH"), { params: { id: "rep-1" } });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("NO_APPROVED_CLAIMS");
  });
  it("submission pins exactly the approved claims, compare-and-swap on status", async () => {
    session("u-a", "NGO");
    db.outcomeClaim.findMany.mockResolvedValue([claim("cl-1", "APPROVED"), claim("cl-2", "SUBMITTED")]);
    const res = await NGO_PATCH(json({ action: "SUBMIT" }, "PATCH"), { params: { id: "rep-1" } });
    expect(res.status).toBe(200);
    const call = db.contractImpactReport.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "rep-1", status: "DRAFT" });
    expect(call.data).toMatchObject({ status: "SUBMITTED", claimIds: ["cl-1"] });
  });
  it("an NGO cannot publish its own report", async () => {
    session("u-a", "NGO");
    db.contractImpactReport.findUnique.mockResolvedValue({ ...draft, status: "SUBMITTED" });
    const res = await NGO_PATCH(json({ action: "PUBLISH" }, "PATCH"), { params: { id: "rep-1" } });
    expect(res.status).toBe(403);
  });
});

describe("admin decision", () => {
  it("rejects a non-admin", async () => {
    session("u-a", "NGO");
    expect((await ADMIN_PATCH(json({ action: "PUBLISH" }, "PATCH"), { params: { id: "rep-1" } })).status).toBe(403);
  });
  it("publishes a submitted report, logs ids only, and notifies the donor", async () => {
    session("admin-1", "ADMIN");
    db.contractImpactReport.findUnique.mockResolvedValue({ ...draft, status: "SUBMITTED", claimIds: ["cl-1"] });
    const res = await ADMIN_PATCH(json({ action: "PUBLISH" }, "PATCH"), { params: { id: "rep-1" } });
    expect(res.status).toBe(200);
    expect(db.contractImpactReport.updateMany.mock.calls[0][0].data).toMatchObject({ status: "PUBLISHED", publishedById: "admin-1" });
    const log = (logAdminAction as any).mock.calls[0][0];
    expect(log).toMatchObject({ action: "IMPACT_REPORT_PUBLISHED", entityType: "IMPACT_REPORT", entityId: "rep-1" });
    expect(JSON.stringify(log.metadata)).not.toContain("@");
    expect(db.notification.create.mock.calls[0][0].data.userId).toBe("donor-1");
  });
  it("a return needs a note", async () => {
    session("admin-1", "ADMIN");
    db.contractImpactReport.findUnique.mockResolvedValue({ ...draft, status: "SUBMITTED" });
    expect((await ADMIN_PATCH(json({ action: "RETURN" }, "PATCH"), { params: { id: "rep-1" } })).status).toBe(400);
  });
  it("409 when another reviewer decided first", async () => {
    session("admin-1", "ADMIN");
    db.contractImpactReport.findUnique.mockResolvedValue({ ...draft, status: "SUBMITTED" });
    db.contractImpactReport.updateMany.mockResolvedValue({ count: 0 });
    expect((await ADMIN_PATCH(json({ action: "PUBLISH" }, "PATCH"), { params: { id: "rep-1" } })).status).toBe(409);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});
