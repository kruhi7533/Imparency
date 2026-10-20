import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * "Run now" from /admin/ops. Admin only, registered jobs only (never an
 * arbitrary path), goes through the job's real cron route with CRON_SECRET and
 * the MANUAL trigger, and is audit-logged with ids only.
 */

const db = vi.hoisted(() => ({ adminActionLog: { create: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/admin/ops/[job]/run/route";

const call = (job: string) => POST(new Request("http://localhost:3001/api/admin/ops/x/run", { method: "POST" }), { params: { job } });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret-123";
  (getServerSession as any).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/admin/ops/[job]/run", () => {
  it("runs a registered job through its real cron route, as MANUAL, with the secret", async () => {
    const res = await call("re-engagement");
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3001/api/cron/re-engagement");
    expect(init.headers.authorization).toBe("Bearer cron-secret-123");
    expect(init.headers["x-job-trigger"]).toBe("MANUAL");
  });

  it("logs the manual run against the job, with no personal data", async () => {
    await call("deliver-impact");
    const data = db.adminActionLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ adminId: "admin-1", action: "JOB_RUN_MANUALLY", entityType: "JOB", entityId: "deliver-impact" });
    expect(JSON.stringify(data)).not.toContain("@");
  });

  it("an unknown job is 404 and nothing is fetched — no arbitrary paths", async () => {
    expect((await call("../../admin/delete-everything")).status).toBe(404);
    expect((await call("not-a-job")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only admins", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "d", role: "DONOR" } });
    expect((await call("re-engagement")).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("without CRON_SECRET it refuses rather than calling the job unauthenticated", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("re-engagement")).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failing job is reported as a failure", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    const res = await call("re-engagement");
    expect(res.status).toBe(502);
    expect((await res.json()).status).toBe(500);
  });
});
