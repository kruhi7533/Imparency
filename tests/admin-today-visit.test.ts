import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    adminInboxVisit: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/admin/today/visit/route";
import { VISIT_GAP_MS } from "@/lib/today-inbox";

const db = prisma as any;
const session = getServerSession as any;

/**
 * What these tests protect.
 *
 * "New since you last looked" is only meaningful if the marker moves at the
 * right moments. Advance it too eagerly and a refresh empties the page the
 * reader is still looking at; never advance it and everything is new forever.
 */

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.adminInboxVisit.findUnique.mockResolvedValue(null);
  db.adminInboxVisit.create.mockResolvedValue({});
  db.adminInboxVisit.update.mockResolvedValue({});
});

describe("who may record a visit", () => {
  it("refuses an unauthenticated caller", async () => {
    session.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(db.adminInboxVisit.create).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(db.adminInboxVisit.create).not.toHaveBeenCalled();
  });
});

describe("when the marker moves", () => {
  it("starts tracking on an admin's first ever visit", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ advanced: true });
    expect(db.adminInboxVisit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ adminId: "admin_1" }) })
    );
  });

  it("treats a quick refresh as the same visit", async () => {
    // Otherwise reloading wipes out the "new" list the reader is looking at.
    db.adminInboxVisit.findUnique.mockResolvedValue({
      adminId: "admin_1",
      lastVisitAt: new Date(Date.now() - 60_000),
    });

    const res = await POST();
    expect(await res.json()).toEqual({ advanced: false });
    expect(db.adminInboxVisit.update).not.toHaveBeenCalled();
  });

  it("advances after a real gap, carrying the old boundary forward", async () => {
    const lastVisitAt = new Date(Date.now() - VISIT_GAP_MS - 60_000);
    db.adminInboxVisit.findUnique.mockResolvedValue({ adminId: "admin_1", lastVisitAt });

    const res = await POST();
    expect(await res.json()).toEqual({ advanced: true });

    // previousVisitAt becomes the START of the visit just ended — that is the
    // line "new since you last looked" is drawn against.
    const { data } = db.adminInboxVisit.update.mock.calls[0][0];
    expect(data.previousVisitAt).toBe(lastVisitAt);
    expect(data.lastVisitAt.getTime()).toBeGreaterThan(lastVisitAt.getTime());
  });

  it("is scoped to the calling admin", async () => {
    db.adminInboxVisit.findUnique.mockResolvedValue({
      adminId: "admin_1",
      lastVisitAt: new Date(Date.now() - VISIT_GAP_MS - 1000),
    });
    await POST();
    expect(db.adminInboxVisit.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { adminId: "admin_1" } })
    );
  });
});
