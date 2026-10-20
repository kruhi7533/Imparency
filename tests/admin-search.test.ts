import { describe, it, expect, vi, beforeEach } from "vitest";

/** Global admin search: admin only, POST body (never a URL), bounded, exact ids match. */

const db = vi.hoisted(() => ({
  nGOProfile: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  project: { findMany: vi.fn() },
  sponsorRequirement: { findMany: vi.fn() },
  contract: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/admin/search/route";

const search = (q: unknown) => POST(new Request("http://localhost/api/admin/search", { method: "POST", body: JSON.stringify({ q }) }));

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  for (const m of Object.values(db)) (m as any).findMany.mockResolvedValue([]);
});

describe("POST /api/admin/search", () => {
  it("returns grouped results across the catalogue", async () => {
    db.nGOProfile.findMany.mockResolvedValue([{ id: "ngo-1", orgName: "Akshar Foundation", verificationStatus: "VERIFIED" }]);
    db.contract.findMany.mockResolvedValue([{ id: "c-1", contractNumber: "CTR-1", title: "Grant", status: "ACTIVE" }]);
    const { results } = await (await search("akshar")).json();
    expect(results.map((r: any) => [r.kind, r.href])).toEqual([
      ["Organisation", "/admin/ngos/ngo-1"],
      ["Contract", "/admin/contracts/c-1"],
    ]);
  });

  it("matches exact ids and is case-insensitive on names; donors only among users", async () => {
    await search("abc123");
    const where = db.user.findMany.mock.calls[0][0].where;
    expect(where.role).toBe("DONOR");
    expect(where.OR).toContainEqual({ id: "abc123" });
    expect(where.OR).toContainEqual({ email: { contains: "abc123", mode: "insensitive" } });
    expect(db.contract.findMany.mock.calls[0][0].take).toBe(8);
  });

  it("refuses a too-short query and non-admins", async () => {
    expect((await search("a")).status).toBe(400);
    (getServerSession as any).mockResolvedValue({ user: { id: "d", role: "DONOR" } });
    expect((await search("akshar")).status).toBe(403);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
