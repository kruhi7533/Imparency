import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET/PATCH /api/user/notifications — the bell and the full /notifications
 * page. Every read and write is scoped to the session user; the keyset cursor
 * is a position, never a lookup of someone else's row.
 */

const db = vi.hoisted(() => ({
  notification: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { GET, PATCH } from "@/app/api/user/notifications/route";

const n = (i: number) => ({ id: `n-${i}`, type: "PROJECT_FUNDED", title: "t", body: "b", read: false, createdAt: new Date(Date.UTC(2026, 9, 20, 12, 0, 60 - i)) });

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue({ user: { id: "user-1", role: "DONOR" } });
  db.notification.count.mockResolvedValue(3);
});

describe("GET", () => {
  it("with no parameters it is the bell's query: this user's latest 20", async () => {
    db.notification.findMany.mockResolvedValue([n(1), n(2)]);
    const res = await GET(new Request("http://localhost/api/user/notifications"));
    const body = await res.json();
    expect(db.notification.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: "user-1" }, take: 21 });
    expect(body).toMatchObject({ unreadCount: 3, nextCursor: null });
    expect(body.notifications).toHaveLength(2);
  });

  it("pages with a keyset cursor and still filters by the session user", async () => {
    db.notification.findMany.mockResolvedValue([n(1), n(2), n(3)]);
    const first = await (await GET(new Request("http://localhost/x?limit=2"))).json();
    expect(first.notifications).toHaveLength(2);
    expect(first.nextCursor).toBe(`${n(2).createdAt.toISOString()}|n-2`);

    db.notification.findMany.mockResolvedValue([n(3)]);
    await GET(new Request(`http://localhost/x?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`));
    const where = db.notification.findMany.mock.calls[1][0].where;
    expect(where.userId).toBe("user-1");
    expect(where.OR).toEqual([{ createdAt: { lt: n(2).createdAt } }, { createdAt: n(2).createdAt, id: { lt: "n-2" } }]);
  });

  it("a malformed cursor is ignored rather than erroring; limit is clamped; unread filter applies", async () => {
    db.notification.findMany.mockResolvedValue([]);
    await GET(new Request("http://localhost/x?cursor=garbage&limit=999&unread=1"));
    const args = db.notification.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "user-1", read: false });
    expect(args.take).toBe(51);
  });

  it("requires a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/x"))).status).toBe(401);
  });
});

describe("PATCH", () => {
  it("marks only the session user's notifications read", async () => {
    db.notification.updateMany.mockResolvedValue({ count: 1 });
    await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ ids: ["n-1", "someone-elses"] }) }));
    expect(db.notification.updateMany).toHaveBeenCalledWith({ where: { userId: "user-1", id: { in: ["n-1", "someone-elses"] } }, data: { read: true } });
  });
});
