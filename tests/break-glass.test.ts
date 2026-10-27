import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ADM-020 — break-glass support access: SUPPORT only, mandatory reason,
 * time-boxed (≤60 min) and auto-expiring, revocable, every use audited.
 */

const H = vi.hoisted(() => ({ requestLine: null as null | { method: string; path: string } }));
vi.mock("@/lib/prisma", () => ({
  default: {
    breakGlassGrant: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    nGOProfile: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: () => new Headers(H.requestLine ? { "x-ib-method": H.requestLine.method, "x-ib-path": H.requestLine.path } : {}),
}));

import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-log";
import { getServerSession } from "next-auth/next";
import { grantIsActive, recordGrantUse, requestGrant, revokeGrant, findActiveGrant } from "@/lib/break-glass";
import { verifySessionRole } from "@/lib/auth-guards";
import { POST as requestRoute } from "@/app/api/admin/break-glass/route";

const db = prisma as any;
const audit = logAdminAction as any;
const session = getServerSession as any;
const SUPPORT = { id: "sup-1", adminRole: "SUPPORT" };
const SUPER = { id: "sup-0", adminRole: null };
const ORG = { orgType: "NGO" as const, orgId: "ngo-1" };

beforeEach(() => {
  vi.clearAllMocks();
  H.requestLine = null;
  db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-1" });
  db.breakGlassGrant.findFirst.mockResolvedValue(null);
  db.breakGlassGrant.create.mockImplementation(async ({ data }: any) => ({ id: "g-1", ...data, createdAt: new Date(), revokedAt: null }));
});
afterEach(() => vi.useRealTimers());

describe("requesting a grant", () => {
  it("SUPPORT gets a 60-minute grant with the reason recorded, audited with ids only", async () => {
    const g = await requestGrant(SUPPORT, { ...ORG, reason: "Ticket #4411: NGO cannot see payout" });
    const data = db.breakGlassGrant.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ adminId: "sup-1", orgType: "NGO", orgId: "ngo-1", reason: "Ticket #4411: NGO cannot see payout" });
    const mins = (data.expiresAt.getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(59.9);
    expect(mins).toBeLessThanOrEqual(60);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "BREAK_GLASS_GRANTED", entityType: "BREAK_GLASS_GRANT", entityId: g.id }));
    // The free-text reason does not go into the audit payload.
    expect(JSON.stringify(audit.mock.calls[0][0])).not.toContain("Ticket #4411");
  });

  it("the reason is mandatory (≥15 chars) and the duration is capped at 60", async () => {
    await expect(requestGrant(SUPPORT, { ...ORG, reason: "" })).rejects.toMatchObject({ status: 400 });
    await expect(requestGrant(SUPPORT, { ...ORG, reason: "because" })).rejects.toMatchObject({ status: 400 });
    await expect(requestGrant(SUPPORT, { ...ORG, reason: "Ticket #1 long enough reason", minutes: 240 })).rejects.toMatchObject({ status: 400 });
    expect(db.breakGlassGrant.create).not.toHaveBeenCalled();
  });

  it("only SUPPORT admins request grants; the org must exist; one active grant per org", async () => {
    await expect(requestGrant(SUPER, { ...ORG, reason: "Ticket #1 long enough reason" })).rejects.toMatchObject({ status: 403 });
    await expect(requestGrant({ id: "f", adminRole: "FINANCE" }, { ...ORG, reason: "Ticket #1 long enough reason" })).rejects.toMatchObject({ status: 403 });
    db.nGOProfile.findUnique.mockResolvedValue(null);
    await expect(requestGrant(SUPPORT, { ...ORG, reason: "Ticket #1 long enough reason" })).rejects.toMatchObject({ status: 404 });
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-1" });
    db.breakGlassGrant.findFirst.mockResolvedValue({ id: "g-old" });
    await expect(requestGrant(SUPPORT, { ...ORG, reason: "Ticket #1 long enough reason" })).rejects.toMatchObject({ status: 409 });
  });

  it("the route maps errors to structured JSON", async () => {
    session.mockResolvedValue({ user: { id: "sup-1", role: "ADMIN", adminRole: "SUPPORT" } });
    H.requestLine = { method: "POST", path: "/api/admin/break-glass" };
    const res = await requestRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ ...ORG, reason: "short" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reason/);
  });
});

describe("expiry and revocation", () => {
  it("a grant is active until expiresAt and not a millisecond after", () => {
    const now = new Date("2026-10-27T10:00:00Z");
    const g = { expiresAt: new Date("2026-10-27T11:00:00Z"), revokedAt: null };
    expect(grantIsActive(g, now)).toBe(true);
    expect(grantIsActive(g, new Date("2026-10-27T10:59:59.999Z"))).toBe(true);
    expect(grantIsActive(g, new Date("2026-10-27T11:00:00Z"))).toBe(false);
    expect(grantIsActive({ ...g, revokedAt: now }, now)).toBe(false);
  });

  it("the active-grant query filters on unrevoked + unexpired at the time of the call (fake clock)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    await findActiveGrant("sup-1", ORG);
    const where = db.breakGlassGrant.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ adminId: "sup-1", orgType: "NGO", orgId: "ngo-1", revokedAt: null });
    expect(where.expiresAt.gt.toISOString()).toBe("2026-10-27T12:00:00.000Z");
    vi.setSystemTime(new Date("2026-10-27T13:30:00Z"));
    await findActiveGrant("sup-1", ORG);
    expect(db.breakGlassGrant.findFirst.mock.calls[1][0].where.expiresAt.gt.toISOString()).toBe("2026-10-27T13:30:00.000Z");
  });

  it("holder or SUPER can revoke (compare-and-swap); others cannot; ended grants 409", async () => {
    const live = { id: "g-1", adminId: "sup-1", expiresAt: new Date(Date.now() + 60_000), revokedAt: null };
    db.breakGlassGrant.findUnique.mockResolvedValue(live);
    db.breakGlassGrant.updateMany.mockResolvedValue({ count: 1 });
    await revokeGrant(SUPPORT, "g-1");
    expect(db.breakGlassGrant.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "g-1", revokedAt: null }, data: { revokedById: "sup-1" } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "BREAK_GLASS_REVOKED" }));
    await revokeGrant(SUPER, "g-1");
    await expect(revokeGrant({ id: "sup-2", adminRole: "SUPPORT" }, "g-1")).rejects.toMatchObject({ status: 403 });
    db.breakGlassGrant.findUnique.mockResolvedValue({ ...live, expiresAt: new Date(Date.now() - 1) });
    await expect(revokeGrant(SUPPORT, "g-1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("enforcement: elevated actions need a live grant and are each audited", () => {
  beforeEach(() => session.mockResolvedValue({ user: { id: "sup-1", role: "ADMIN", adminRole: "SUPPORT" } }));

  it("without a grant a SUPPORT admin is refused on the org's admin routes", async () => {
    H.requestLine = { method: "POST", path: "/api/admin/ngos/ngo-1/nudge" };
    const r = await verifySessionRole("ADMIN" as any);
    expect(r.authorized).toBe(false);
    expect(r.response!.status).toBe(403);
    expect((await r.response!.json()).code).toBe("BREAK_GLASS_REQUIRED");
  });

  it("with a grant the request passes and leaves a BREAK_GLASS_ACTION audit row (method + path, ids only)", async () => {
    db.breakGlassGrant.findFirst.mockResolvedValue({ id: "g-1" });
    H.requestLine = { method: "POST", path: "/api/admin/ngos/ngo-1/nudge" };
    const r = await verifySessionRole("ADMIN" as any);
    expect(r.authorized).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BREAK_GLASS_ACTION",
        entityId: "g-1",
        metadata: { orgType: "NGO", orgId: "ngo-1", method: "POST", path: "/api/admin/ngos/ngo-1/nudge" },
      })
    );
  });

  it("a grant for org A does not open org B", async () => {
    db.breakGlassGrant.findFirst.mockImplementation(async ({ where }: any) => (where.orgId === "ngo-1" ? { id: "g-1" } : null));
    H.requestLine = { method: "GET", path: "/api/admin/ngos/ngo-2/trust-insight" };
    expect((await verifySessionRole("ADMIN" as any)).authorized).toBe(false);
    expect(await recordGrantUse("sup-1", { orgType: "NGO", orgId: "ngo-2" }, { method: "GET", path: "/x" })).toBeNull();
  });

  it("SUPPORT still cannot make general admin writes even with a grant", async () => {
    db.breakGlassGrant.findFirst.mockResolvedValue({ id: "g-1" });
    H.requestLine = { method: "POST", path: "/api/admin/verify-ngo" };
    expect((await verifySessionRole("ADMIN" as any)).authorized).toBe(false);
  });
});
