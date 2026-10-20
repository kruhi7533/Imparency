import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every route that changes a contract or its money is rate-limited, and a
 * blocked request writes nothing. The static half fails the build when a new
 * contract write route is added without a limit — the same idea as
 * tests/admin-audit-coverage.test.ts.
 */

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routes(p) : name === "route.ts" ? [p] : [];
  });
}

describe("contract write routes are rate-limited", () => {
  const files = routes(join(process.cwd(), "app", "api", "contracts"));

  it.each(files.map((f) => [f.replace(process.cwd(), "")]))("%s", (rel) => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    const writes = (src.match(/export async function (POST|PATCH|PUT|DELETE)\b/g) ?? []).length;
    if (writes === 0) return; // read-only route
    const limited = (src.match(/checkRateLimit\(/g) ?? []).length;
    expect(limited, "every write handler calls checkRateLimit").toBeGreaterThanOrEqual(writes);
  });
});

const db = vi.hoisted(() => ({ contract: { findUnique: vi.fn() }, contractPayment: { create: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "donor-1", role: "DONOR" } })) }));
vi.mock("@/lib/rate-limiter", async () => {
  const { NextResponse } = await import("next/server");
  return { checkRateLimit: vi.fn(async () => ({ isBlocked: true, response: NextResponse.json({ error: "Too many requests." }, { status: 429 }) })) };
});

import { POST as RECORD_PAYMENT } from "@/app/api/contracts/[id]/payments/route";

describe("a blocked request writes nothing", () => {
  it("recording a payment over the limit is 429 before any read or write", async () => {
    const res = await RECORD_PAYMENT(new Request("http://localhost", { method: "POST", body: "{}" }), { params: { id: "c-1" } });
    expect(res.status).toBe(429);
    expect(db.contract.findUnique).not.toHaveBeenCalled();
    expect(db.contractPayment.create).not.toHaveBeenCalled();
  });
});
