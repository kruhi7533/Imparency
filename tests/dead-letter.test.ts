import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ADM-018 / NEG-012 — operator dead-letter queue.
 *
 *  - failed work lands in the queue with ids only;
 *  - replay is ONE-TIME: OPEN -> REPLAYING is a compare-and-swap, so a second
 *    replay (double click, two admins, retried request) runs nothing (409);
 *  - a replayed impact delivery already SENT is not sent again;
 *  - every replay / dismissal is audited; the API is admin-only.
 */

const db = vi.hoisted(() => ({
  deadLetter: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  impactDelivery: { findUnique: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
  notification: { create: vi.fn() },
  jobRun: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  adminActionLog: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ isBlocked: false }) }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendImpactUpdateEmail: vi.fn().mockResolvedValue({ success: true }) }));

import { getServerSession } from "next-auth/next";
import { recordDeadLetter, replayDeadLetter, dismissDeadLetter } from "@/lib/dead-letter";
import { runJob } from "@/lib/job-runner";
import { POST as REPLAY } from "@/app/api/admin/dead-letters/[id]/replay/route";
import { POST as DISMISS } from "@/app/api/admin/dead-letters/[id]/dismiss/route";
import { GET as LIST } from "@/app/api/admin/dead-letters/route";
import { GET as INSPECT } from "@/app/api/admin/dead-letters/[id]/route";

const session = getServerSession as any;
const ctx = { adminId: "admin_1", origin: "http://localhost:3000" };
const req = (url = "http://localhost/api/admin/dead-letters/dl1/replay") => new Request(url, { method: "POST" });

/** A tiny in-memory DeadLetter table honouring the CAS the code relies on. */
function memoryQueue(initial: Record<string, any>) {
  const rows: Record<string, any> = { ...initial };
  db.deadLetter.updateMany.mockImplementation(async ({ where, data }: any) => {
    const r = rows[where.id];
    const statusOk = typeof where.status === "string" ? r?.status === where.status : where.status.in.includes(r?.status);
    if (!r || !statusOk) return { count: 0 };
    Object.assign(r, data);
    return { count: 1 };
  });
  db.deadLetter.findUnique.mockImplementation(async ({ where }: any) => (rows[where.id] ? { ...rows[where.id] } : null));
  db.deadLetter.update.mockImplementation(async ({ where, data }: any) => Object.assign(rows[where.id], data));
  return rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recording", () => {
  it("is idempotent per (kind, sourceId) and carries ids only", async () => {
    await recordDeadLetter({ kind: "JOB_RUN", sourceId: "run1", refs: { job: "deliver-impact", jobRunId: "run1" }, errorMessage: "x".repeat(900), attempts: 1 });
    const arg = db.deadLetter.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ kind_sourceId: { kind: "JOB_RUN", sourceId: "run1" } });
    expect(arg.create.errorMessage).toHaveLength(500);
  });

  it("never throws when the queue itself is down", async () => {
    db.deadLetter.upsert.mockRejectedValue(new Error("db down"));
    await expect(recordDeadLetter({ kind: "JOB_RUN", sourceId: "r", refs: {}, errorMessage: null, attempts: 1 })).resolves.toBeUndefined();
  });

  it("a failed job run lands in the queue", async () => {
    db.jobRun.create.mockResolvedValue({ id: "run9" });
    db.jobRun.findFirst.mockResolvedValue(null);
    await expect(runJob("deliver-impact", {}, async () => { throw new Error("smtp down"); })).rejects.toThrow("smtp down");
    expect(db.deadLetter.upsert).toHaveBeenCalledTimes(1);
    const arg = db.deadLetter.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ kind: "JOB_RUN", sourceId: "run9", refs: expect.objectContaining({ job: "deliver-impact", jobRunId: "run9" }) });
  });
});

describe("replay is one-time and idempotent", () => {
  it("runs the handler once; a second replay is a conflict and runs nothing", async () => {
    const rows = memoryQueue({ dl1: { id: "dl1", kind: "JOB_RUN", sourceId: "run1", refs: { job: "deliver-impact" }, status: "OPEN" } });
    const handler = vi.fn().mockResolvedValue({ ok: 1 });
    const handlers = { JOB_RUN: handler, IMPACT_DELIVERY: vi.fn(), NOTIFICATION_DELIVERY: vi.fn() };

    const first = await replayDeadLetter("dl1", ctx, handlers);
    const second = await replayDeadLetter("dl1", ctx, handlers);

    expect(first).toMatchObject({ ok: true, status: "REPLAYED" });
    expect(second).toMatchObject({ ok: false, conflict: true, currentStatus: "REPLAYED" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(rows.dl1.replayedById).toBe("admin_1");
  });

  it("two concurrent replays run the work once", async () => {
    memoryQueue({ dl1: { id: "dl1", kind: "JOB_RUN", sourceId: "run1", refs: { job: "x" }, status: "OPEN" } });
    const handler = vi.fn().mockResolvedValue({});
    const handlers = { JOB_RUN: handler, IMPACT_DELIVERY: vi.fn(), NOTIFICATION_DELIVERY: vi.fn() };
    const results = await Promise.all([replayDeadLetter("dl1", ctx, handlers), replayDeadLetter("dl1", ctx, handlers)]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => "conflict" in r)).toHaveLength(1);
  });

  it("a replay that fails again is REPLAY_FAILED with the error, and cannot be replayed again", async () => {
    const rows = memoryQueue({ dl1: { id: "dl1", kind: "JOB_RUN", sourceId: "run1", refs: {}, status: "OPEN" } });
    const handlers = { JOB_RUN: vi.fn().mockRejectedValue(new Error("still down")), IMPACT_DELIVERY: vi.fn(), NOTIFICATION_DELIVERY: vi.fn() };
    expect(await replayDeadLetter("dl1", ctx, handlers)).toMatchObject({ status: "REPLAY_FAILED", result: { error: "still down" } });
    expect(rows.dl1.status).toBe("REPLAY_FAILED");
    expect(await replayDeadLetter("dl1", ctx, handlers)).toMatchObject({ conflict: true });
  });

  it("an impact delivery already SENT is not delivered twice", async () => {
    memoryQueue({ dl1: { id: "dl1", kind: "IMPACT_DELIVERY", sourceId: "del1", refs: {}, status: "OPEN" } });
    db.impactDelivery.findUnique.mockResolvedValue({ id: "del1", status: "SENT", channel: "IN_APP", event: { projectId: "p" } });
    const out = await replayDeadLetter("dl1", ctx);
    expect(out).toMatchObject({ ok: true, result: { alreadyDelivered: true } });
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("a FAILED in-app impact delivery is delivered once and marked SENT by CAS", async () => {
    memoryQueue({ dl1: { id: "dl1", kind: "IMPACT_DELIVERY", sourceId: "del1", refs: {}, status: "OPEN" } });
    db.impactDelivery.findUnique.mockResolvedValue({ id: "del1", donorId: "d1", status: "FAILED", channel: "IN_APP", event: { projectId: "p", title: "T", body: "B" } });
    db.user.findUnique.mockResolvedValue({ id: "d1", name: "n", email: "e" });
    db.project.findUnique.mockResolvedValue({ title: "P" });
    await replayDeadLetter("dl1", ctx);
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.impactDelivery.updateMany.mock.calls[0][0].where).toEqual({ id: "del1", status: { not: "SENT" } });
  });

  it("dismiss closes OPEN / REPLAY_FAILED only", async () => {
    memoryQueue({ a: { id: "a", status: "OPEN" }, b: { id: "b", status: "REPLAYED" } });
    expect(await dismissDeadLetter("a", "admin_1")).toEqual({ ok: true, currentStatus: "DISMISSED" });
    expect(await dismissDeadLetter("b", "admin_1")).toEqual({ ok: false, currentStatus: "REPLAYED" });
  });
});

describe("routes", () => {
  it("are admin-only", async () => {
    session.mockResolvedValue({ user: { id: "d", role: "DONOR" } });
    expect((await LIST(new Request("http://localhost/api/admin/dead-letters"))).status).toBe(403);
    expect((await INSPECT(new Request("http://x"), { params: { id: "dl1" } })).status).toBe(403);
    expect((await REPLAY(req(), { params: { id: "dl1" } })).status).toBe(403);
    expect((await DISMISS(req(), { params: { id: "dl1" } })).status).toBe(403);
    expect(db.deadLetter.updateMany).not.toHaveBeenCalled();
  });

  it("replay twice: 502/200 first, 409 second, and only the real replay is audited", async () => {
    memoryQueue({ dl1: { id: "dl1", kind: "IMPACT_DELIVERY", sourceId: "del1", refs: {}, status: "OPEN" } });
    db.impactDelivery.findUnique.mockResolvedValue({ id: "del1", status: "SENT", channel: "IN_APP", event: { projectId: "p" } });
    const first = await REPLAY(req(), { params: { id: "dl1" } });
    expect(first.status).toBe(200);
    const second = await REPLAY(req(), { params: { id: "dl1" } });
    expect(second.status).toBe(409);
    expect(db.adminActionLog.create).toHaveBeenCalledTimes(1);
    expect(db.adminActionLog.create.mock.calls[0][0].data).toMatchObject({ action: "DEAD_LETTER_REPLAYED", entityType: "DEAD_LETTER", entityId: "dl1" });
  });

  it("replay of an unknown id is 404", async () => {
    memoryQueue({});
    expect((await REPLAY(req(), { params: { id: "nope" } })).status).toBe(404);
  });

  it("dismiss is audited", async () => {
    memoryQueue({ dl1: { id: "dl1", status: "OPEN" } });
    expect((await DISMISS(req(), { params: { id: "dl1" } })).status).toBe(200);
    expect(db.adminActionLog.create.mock.calls[0][0].data.action).toBe("DEAD_LETTER_DISMISSED");
  });
});
