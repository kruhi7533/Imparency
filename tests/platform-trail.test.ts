import { describe, it, expect, vi, beforeEach } from "vitest";

/** The platform trail: merged newest-first, filterable, and never selects identity values. */

const db = vi.hoisted(() => ({
  contractAuditLog: { findMany: vi.fn() },
  requirementAuditLog: { findMany: vi.fn() },
  complianceAuditLog: { findMany: vi.fn() },
  donorEvent: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));

import { loadPlatformTrail, parseTrailQuery } from "@/lib/platform-trail";

const d = (s: string) => new Date(s);

beforeEach(() => {
  vi.clearAllMocks();
  db.contractAuditLog.findMany.mockResolvedValue([{ createdAt: d("2026-10-20"), action: "PAYMENT_CONFIRMED", actorRole: "NGO", actorId: "u1", contractId: "c-1", detail: null }]);
  db.requirementAuditLog.findMany.mockResolvedValue([{ createdAt: d("2026-10-19"), action: "REQUIREMENT_VALIDATED", actorRole: "ADMIN", actorId: "a1", requirementId: "r-1", detail: null, fromStatus: "PENDING_ADMIN_REVIEW", toStatus: "VALIDATED" }]);
  db.complianceAuditLog.findMany.mockResolvedValue([{ createdAt: d("2026-10-21"), event: "PAN_VERIFIED", actorId: null, detail: "ok", compliance: { ngoId: "ngo-1" } }]);
  db.donorEvent.findMany.mockResolvedValue([{ createdAt: d("2026-10-18"), eventType: "PAN_VERIFIED", source: "SYSTEM", initiatedBy: null, donorId: "donor-1" }]);
});

describe("parseTrailQuery", () => {
  it("defaults to all sources and the last 7 days; one source when asked", () => {
    const now = d("2026-10-21T12:00:00Z");
    const q = parseTrailQuery({}, now);
    expect(q.sources).toHaveLength(4);
    expect(q.to).toEqual(now);
    expect(q.from).toEqual(new Date(now.getTime() - 7 * 86_400_000));
    expect(parseTrailQuery({ source: "contract" }).sources).toEqual(["contract"]);
    expect(parseTrailQuery({ source: "bogus" }).sources).toHaveLength(4);
  });

  it("an inclusive end-of-day 'to'", () => {
    expect(parseTrailQuery({ to: "2026-10-21" }).to.toISOString()).toBe("2026-10-21T23:59:59.999Z");
  });
});

describe("loadPlatformTrail", () => {
  it("merges every source newest first, with a link to each subject", async () => {
    const items = await loadPlatformTrail(parseTrailQuery({}, d("2026-10-22")));
    expect(items.map((i) => i.source)).toEqual(["compliance", "contract", "requirement", "donor"]);
    expect(items.find((i) => i.source === "requirement")!.detail).toBe("PENDING_ADMIN_REVIEW → VALIDATED");
    expect(items.map((i) => i.href)).toEqual(["/admin/ngos/ngo-1", "/admin/contracts/c-1", "/admin/requirements/r-1", "/admin/donors/donor-1"]);
  });

  it("queries only the chosen source", async () => {
    await loadPlatformTrail(parseTrailQuery({ source: "contract" }));
    expect(db.contractAuditLog.findMany).toHaveBeenCalled();
    expect(db.donorEvent.findMany).not.toHaveBeenCalled();
  });

  it("never selects donor-event values (PAN, category)", async () => {
    await loadPlatformTrail(parseTrailQuery({}));
    const select = db.donorEvent.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("oldValue");
    expect(select).not.toHaveProperty("newValue");
  });
});
