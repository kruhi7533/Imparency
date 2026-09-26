import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The diagnostics endpoint reports internal timing, retry counters and process
 * state. Two things are worth pinning:
 *
 *   1. It is ADMIN-only. This is not a public health check — a non-admin (or
 *      anonymous) caller must never learn how the database is behaving.
 *   2. It reports rather than throws when the database is unreachable. A
 *      diagnostics endpoint that 500s exactly when the database is down is
 *      useless at the only moment anyone needs it.
 */

vi.mock("@/lib/prisma", () => ({
  default: { $queryRaw: vi.fn() },
  getRetryStats: vi.fn(),
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import prisma, { getRetryStats } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/admin/diagnostics/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;
const getRetryStatsMock = getRetryStats as any;

const NO_RETRIES = { total: 0, byCode: {}, byOperation: {}, totalDelayMs: 0 };

describe("GET /api/admin/diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    getRetryStatsMock.mockReturnValue(NO_RETRIES);
  });

  it("refuses an anonymous caller", async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    // Nothing about the database should be probed before authorising.
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("refuses a non-admin caller — this is not a public health check", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "ngo_1", role: "NGO" } });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("reports round-trip time and retry counters for an admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    getRetryStatsMock.mockReturnValue({
      total: 3,
      byCode: { INIT: 2, P1001: 1 },
      byOperation: { "nGOProfile.findMany": 3 },
      totalDelayMs: 1750,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.database.reachable).toBe(true);
    expect(typeof body.database.roundTripMs).toBe("number");
    expect(body.database.retries.total).toBe(3);
    expect(body.database.retries.totalDelayMs).toBe(1750);
    // INIT is surfaced under a name that says what it means, so a reader does
    // not need to know that INIT == PrismaClientInitializationError == cold start.
    expect(body.database.retries.coldStartRetries).toBe(2);
  });

  it("reports coldStartRetries as 0 rather than undefined when INIT has never fired", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    getRetryStatsMock.mockReturnValue({ ...NO_RETRIES, byCode: { P1002: 1 }, total: 1 });

    const body = await (await GET()).json();

    // A missing key would render as blank in a UI, which reads as "unknown"
    // rather than "none" — the distinction this codebase cares about elsewhere.
    expect(body.database.retries.coldStartRetries).toBe(0);
  });

  it("reports unreachable instead of throwing when the database is down", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    const body = await res.json();

    // The moment this endpoint matters most is the moment the database is
    // failing. A 500 here would answer nothing.
    expect(res.status).toBe(200);
    expect(body.database.reachable).toBe(false);
    expect(typeof body.database.roundTripMs).toBe("number");
  });

  it("reports whether captureError has a collector configured", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    const original = process.env.ERROR_WEBHOOK_URL;

    process.env.ERROR_WEBHOOK_URL = "";
    expect((await (await GET()).json()).process.errorCollectorConfigured).toBe(false);

    process.env.ERROR_WEBHOOK_URL = "https://collector.example/hook";
    expect((await (await GET()).json()).process.errorCollectorConfigured).toBe(true);

    if (original === undefined) delete process.env.ERROR_WEBHOOK_URL;
    else process.env.ERROR_WEBHOOK_URL = original;
  });

  it("leaks no connection details, credentials or row data", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });

    const raw = JSON.stringify(await (await GET()).json());

    for (const forbidden of ["postgres", "password", "neon.tech", "DATABASE_URL", "sslmode"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
