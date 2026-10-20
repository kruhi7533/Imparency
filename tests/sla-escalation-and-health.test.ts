import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * SLA breach digest: one notification per admin per day, nothing when all is
 * clear, queue names and counts only. And the public health endpoint: 200 when
 * the database answers, 503 when it does not, never an error message.
 */

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  notification: { findMany: vi.fn(), createMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
const inbox = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/lib/today-sources", () => ({ loadInboxSources: vi.fn(async () => ({})) }));
vi.mock("@/lib/today-inbox", () => ({ buildInboxItems: vi.fn(() => []), breachesByQueue: vi.fn(() => inbox.rows) }));

import { digestText, runSlaEscalation, SLA_DIGEST_TYPE } from "@/lib/sla-escalation";
import { GET as health } from "@/app/api/health/route";

beforeEach(() => {
  vi.clearAllMocks();
  inbox.rows = [];
  db.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
  db.notification.findMany.mockResolvedValue([]);
});

describe("runSlaEscalation", () => {
  it("nothing breached → nothing sent (no daily 'all clear' noise)", async () => {
    expect(await runSlaEscalation()).toEqual({ breachedQueues: 0, notified: 0 });
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("tells every admin once, with queue names and counts only", async () => {
    inbox.rows = [{ queue: "Fraud Alerts", count: 2, worst: 3 }, { queue: "Risk Review", count: 1, worst: 1 }];
    expect(await runSlaEscalation()).toEqual({ breachedQueues: 2, notified: 2 });
    const data = db.notification.createMany.mock.calls[0][0].data;
    expect(data.map((n: any) => n.userId)).toEqual(["admin-1", "admin-2"]);
    expect(data[0]).toMatchObject({ type: SLA_DIGEST_TYPE, title: "3 items are past the response target" });
    expect(data[0].body).toContain("Fraud Alerts: 2 past target (worst 3 days over)");
  });

  it("is idempotent per admin per day — a re-run notifies only who has not been told today", async () => {
    inbox.rows = [{ queue: "Fraud Alerts", count: 1, worst: 1 }];
    db.notification.findMany.mockResolvedValue([{ userId: "admin-1" }]);
    expect(await runSlaEscalation()).toMatchObject({ notified: 1 });
    expect(db.notification.createMany.mock.calls[0][0].data.map((n: any) => n.userId)).toEqual(["admin-2"]);
    db.notification.findMany.mockResolvedValue([{ userId: "admin-1" }, { userId: "admin-2" }]);
    vi.clearAllMocks();
    db.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
    db.notification.findMany.mockResolvedValue([{ userId: "admin-1" }, { userId: "admin-2" }]);
    expect(await runSlaEscalation()).toMatchObject({ notified: 0 });
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("digest text caps the list and pluralises", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ queue: `Q${i}`, count: 1, worst: 1 }));
    const t = digestText(rows);
    expect(t.title).toBe("8 items are past the response target");
    expect(t.body).toContain("and 2 more queues");
    expect(digestText([{ queue: "Q", count: 1, worst: 1 }]).title).toBe("1 item is past the response target");
  });
});

describe("GET /api/health", () => {
  it("200 with the database up", async () => {
    db.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", database: "up" });
  });

  it("503 with the database down, and no error detail leaked", async () => {
    db.$queryRaw.mockRejectedValue(new Error("password authentication failed for user neondb_owner"));
    const res = await health();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/password|neondb/);
  });
});
