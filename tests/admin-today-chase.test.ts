import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: { inboxChase: { upsert: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn(), requestMeta: vi.fn(() => ({})) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { POST, DELETE } from "@/app/api/admin/today/chase/route";

const db = prisma as any;
const session = getServerSession as any;
const audit = logAdminAction as any;

/**
 * What these tests protect.
 *
 * This is the only write the Today inbox makes, and it is a write that HIDES
 * work. Three things must hold: only an admin can do it, it can only hide work
 * somebody else owes (never the admin's own queue), and it must not touch the
 * underlying record — a chased milestone is still overdue.
 */

function req(body: unknown, method = "POST") {
  return new Request("http://localhost/api/admin/today/chase", {
    method,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.inboxChase.upsert.mockResolvedValue({ id: "chase_1" });
  db.inboxChase.deleteMany.mockResolvedValue({ count: 1 });
});

describe("who may chase", () => {
  it("refuses an unauthenticated caller and writes nothing", async () => {
    session.mockResolvedValue(null);
    const res = await POST(req({ itemKey: "overdue-m1" }));
    expect(res.status).toBe(401);
    expect(db.inboxChase.upsert).not.toHaveBeenCalled();
  });

  it("refuses an NGO caller and writes nothing", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await POST(req({ itemKey: "overdue-m1" }));
    expect(res.status).toBe(403);
    expect(db.inboxChase.upsert).not.toHaveBeenCalled();
  });

  it("refuses a DONOR caller on the undo path too", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "DONOR" } });
    const res = await DELETE(req({ itemKey: "overdue-m1" }, "DELETE"));
    expect(res.status).toBe(403);
    expect(db.inboxChase.deleteMany).not.toHaveBeenCalled();
  });
});

describe("what may be chased", () => {
  it("records a chase against an overdue milestone", async () => {
    const res = await POST(req({ itemKey: "overdue-m1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.chasedUntil).toBeTruthy();
    expect(db.inboxChase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { itemKey: "overdue-m1" } })
    );
  });

  it("refuses to hide work the admin owes", async () => {
    // Otherwise this becomes a way to make your own queue look empty.
    for (const key of ["ngo-n1", "alert-a1", "candidate-c1", "quiet-n1"]) {
      const res = await POST(req({ itemKey: key }));
      expect(res.status).toBe(400);
    }
    expect(db.inboxChase.upsert).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed key", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ itemKey: "   " }))).status).toBe(400);
    expect((await POST(req({ itemKey: "overdue-" }))).status).toBe(400);
    expect((await POST(req({ itemKey: "nodash" }))).status).toBe(400);
    expect(db.inboxChase.upsert).not.toHaveBeenCalled();
  });

  it("keeps the whole uuid when splitting the key", async () => {
    // uuids contain dashes; splitting on all of them would truncate the id.
    await POST(req({ itemKey: "overdue-2f8a1b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b" }));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "MILESTONE",
        entityId: "2f8a1b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b",
      })
    );
  });
});

describe("what a chase does and does not do", () => {
  it("hides the item for a week, not forever", async () => {
    const before = Date.now();
    const res = await POST(req({ itemKey: "overdue-m1" }));
    const { chasedUntil } = await res.json();

    const days = (new Date(chasedUntil).getTime() - before) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("writes only the chase — never the milestone itself", async () => {
    // The organisation still has not delivered; marking anything resolved here
    // would lose the work.
    await POST(req({ itemKey: "overdue-m1" }));
    expect(Object.keys(db)).toEqual(["inboxChase"]);
  });

  it("is attributable in the audit trail", async () => {
    await POST(req({ itemKey: "overdue-m1" }));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: "admin_1", action: "INBOX_ITEM_CHASED" })
    );
  });

  it("re-chasing re-dates one row rather than stacking duplicates", async () => {
    await POST(req({ itemKey: "overdue-m1" }));
    await POST(req({ itemKey: "overdue-m1" }));

    expect(db.inboxChase.upsert).toHaveBeenCalledTimes(2);
    for (const call of db.inboxChase.upsert.mock.calls) {
      expect(call[0].where).toEqual({ itemKey: "overdue-m1" });
    }
  });
});

describe("undoing a chase", () => {
  it("clears the row and logs it", async () => {
    const res = await DELETE(req({ itemKey: "overdue-m1" }, "DELETE"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cleared).toBe(true);
    expect(db.inboxChase.deleteMany).toHaveBeenCalledWith({ where: { itemKey: "overdue-m1" } });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "INBOX_CHASE_CLEARED" })
    );
  });

  it("treats undoing an already-gone chase as a no-op, not a 404", async () => {
    db.inboxChase.deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(req({ itemKey: "overdue-m1" }, "DELETE"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cleared).toBe(false);
    // Nothing changed, so nothing to attribute.
    expect(audit).not.toHaveBeenCalled();
  });
});
