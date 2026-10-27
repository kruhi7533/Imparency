import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DON-016 / NGO-020 / E2E-007 — donor re-engagement from a stored report.
 * POST /api/engagement/re-engage with a ContractImpactReport id creates a
 * RenewalRequest (idempotent per report+kind); the NGO answers it.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    contractImpactReport: { findUnique: vi.fn() },
    renewalRequest: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    donorTeamMember: { findUnique: vi.fn() },
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/re-engagement", () => ({ reEngage: vi.fn(async () => ({ status: "not_found" })) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { reEngage } from "@/lib/re-engagement";
import { POST as RE_ENGAGE } from "@/app/api/engagement/re-engage/route";
import { PATCH as RESPOND } from "@/app/api/ngo/renewal-requests/[id]/route";
import { checkRenewalResponse, parseProposedAmount } from "@/lib/renewal-requests";

const db = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const req = (body: unknown, method = "POST") => new Request("http://t", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const report = { id: "rep-1", donorId: "donor-1", ngoId: "ngo-a", contractId: "c-1", status: "PUBLISHED", title: "Q3" };

beforeEach(() => {
  vi.clearAllMocks();
  db.contractImpactReport.findUnique.mockResolvedValue(report);
  db.donorTeamMember.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-viewer" ? { accountId: "donor-1", role: "VIEWER" } : null),
  );
  db.renewalRequest.findUnique.mockResolvedValue(null);
  db.renewalRequest.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "rr-1", kind: data.kind, status: "OPEN" }));
  db.renewalRequest.updateMany.mockResolvedValue({ count: 1 });
  db.nGOProfile.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-ngo-a" ? { id: "ngo-a" } : where.userId === "u-ngo-b" ? { id: "ngo-b" } : where.id === "ngo-a" ? { userId: "u-ngo-a" } : null),
  );
  db.nGOTeamMember.findFirst.mockResolvedValue(null);
});

describe("POST /api/engagement/re-engage with a stored report", () => {
  it("creates a RENEWAL request by default and notifies the NGO", async () => {
    session("donor-1", "DONOR");
    const res = await RE_ENGAGE(req({ reportId: "rep-1", message: "Keen to renew", proposedAmount: "250000.00" }));
    expect(res.status).toBe(201);
    const data = db.renewalRequest.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ reportId: "rep-1", kind: "RENEWAL", ngoId: "ngo-a", donorId: "donor-1", requestedById: "donor-1" });
    expect(data.proposedAmount.toString()).toBe("250000");
    expect(db.notification.create.mock.calls[0][0].data.userId).toBe("u-ngo-a");
    expect(reEngage).not.toHaveBeenCalled();
  });
  it("accepts NEXT_OPPORTUNITY", async () => {
    session("donor-1", "DONOR");
    const res = await RE_ENGAGE(req({ reportId: "rep-1", kind: "NEXT_OPPORTUNITY" }));
    expect(res.status).toBe(201);
    expect(db.renewalRequest.create.mock.calls[0][0].data.kind).toBe("NEXT_OPPORTUNITY");
  });
  it("is idempotent: a replay returns the existing request and creates nothing", async () => {
    session("donor-1", "DONOR");
    db.renewalRequest.findUnique.mockResolvedValue({ id: "rr-1", kind: "RENEWAL", status: "OPEN" });
    const res = await RE_ENGAGE(req({ reportId: "rep-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).existing).toBe(true);
    expect(db.renewalRequest.create).not.toHaveBeenCalled();
  });
  it("treats a lost unique-key race as a replay", async () => {
    session("donor-1", "DONOR");
    db.renewalRequest.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    db.renewalRequest.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "rr-1", kind: "RENEWAL", status: "OPEN" });
    const res = await RE_ENGAGE(req({ reportId: "rep-1" }));
    expect(res.status).toBe(200);
  });
  it("another donor's report is 404", async () => {
    session("donor-2", "DONOR");
    expect((await RE_ENGAGE(req({ reportId: "rep-1" }))).status).toBe(404);
    expect(db.renewalRequest.create).not.toHaveBeenCalled();
  });
  it("an unpublished report cannot be acted on", async () => {
    session("donor-1", "DONOR");
    db.contractImpactReport.findUnique.mockResolvedValue({ ...report, status: "SUBMITTED" });
    expect((await RE_ENGAGE(req({ reportId: "rep-1" }))).status).toBe(409);
  });
  it("a VIEWER on the donor team cannot request a renewal", async () => {
    session("u-viewer", "DONOR");
    expect((await RE_ENGAGE(req({ reportId: "rep-1" }))).status).toBe(403);
  });
  it("an unknown id still falls through to the legacy per-donation path (404)", async () => {
    session("donor-1", "DONOR");
    db.contractImpactReport.findUnique.mockResolvedValue(null);
    expect((await RE_ENGAGE(req({ reportId: "bogus" }))).status).toBe(404);
    expect(reEngage).toHaveBeenCalled();
  });
  it("rejects a bad amount and a bad kind", async () => {
    session("donor-1", "DONOR");
    expect((await RE_ENGAGE(req({ reportId: "rep-1", proposedAmount: "-5" }))).status).toBe(400);
    expect((await RE_ENGAGE(req({ reportId: "rep-1", kind: "DONATE" }))).status).toBe(400);
    expect(parseProposedAmount("1.234")).toMatchObject({ ok: false });
  });
});

describe("NGO answers a request", () => {
  const row = { id: "rr-1", ngoId: "ngo-a", donorId: "donor-1", status: "OPEN", kind: "RENEWAL" };
  beforeEach(() => db.renewalRequest.findUnique.mockResolvedValue(row));

  it("accepts with a compare-and-swap on OPEN and tells the donor", async () => {
    session("u-ngo-a", "NGO");
    const res = await RESPOND(req({ action: "ACCEPT", response: "Yes — proposal next week" }, "PATCH"), { params: { id: "rr-1" } });
    expect(res.status).toBe(200);
    expect(db.renewalRequest.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "rr-1", status: "OPEN" }, data: { status: "ACCEPTED" } });
    expect(db.notification.create.mock.calls[0][0].data.userId).toBe("donor-1");
  });
  it("isolation: org B gets 403 and writes nothing", async () => {
    session("u-ngo-b", "NGO");
    expect((await RESPOND(req({ action: "ACCEPT" }, "PATCH"), { params: { id: "rr-1" } })).status).toBe(403);
    expect(db.renewalRequest.updateMany).not.toHaveBeenCalled();
  });
  it("declining needs a reason; answering twice is 409", () => {
    expect(checkRenewalResponse("OPEN", "DECLINE", "")).toMatchObject({ ok: false, status: 400 });
    expect(checkRenewalResponse("ACCEPTED", "DECLINE", "no")).toMatchObject({ ok: false, status: 409 });
  });
  it("409 when someone answered concurrently", async () => {
    session("u-ngo-a", "NGO");
    db.renewalRequest.updateMany.mockResolvedValue({ count: 0 });
    expect((await RESPOND(req({ action: "ACCEPT" }, "PATCH"), { params: { id: "rr-1" } })).status).toBe(409);
  });
});
