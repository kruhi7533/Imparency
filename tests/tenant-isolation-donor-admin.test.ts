import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cross-tenant isolation, beyond NGO-vs-NGO (tests/tenant-isolation.test.ts).
 * Roadmap row 6, "isolation tests".
 *
 * - Donor A never reaches donor B's contract or CSR requirement.
 * - An NGO never reaches a contract it is not party to.
 * - Admin-negative: a donor or NGO session is refused by admin APIs before any
 *   data is read. The admin layout guards pages; the API is directly reachable,
 *   so each route must refuse on its own.
 */

const db = vi.hoisted(() => {
  const handler: ProxyHandler<any> = {
    get: (target, prop) => {
      if (!(prop in target)) target[prop] = new Proxy({}, { get: (t: any, p) => (t[p] ??= vi.fn()) });
      return target[prop];
    },
  };
  return new Proxy({} as any, handler);
});
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));

import { getServerSession } from "next-auth/next";
import { GET as getContract } from "@/app/api/contracts/[id]/route";
import { GET as getRequirement } from "@/app/api/requirements/[id]/route";

const as = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const get = (url = "http://localhost") => new Request(url);

beforeEach(() => {
  vi.clearAllMocks();
  db.donorTeamMember.findUnique.mockResolvedValue(null);
  db.nGOTeamMember.findFirst.mockResolvedValue(null);
  db.nGOProfile.findUnique.mockResolvedValue(null);
});

describe("donor ↔ donor", () => {
  const contract = { id: "c-1", donorId: "donor-A", ngoId: "ngo-1", ngo: { userId: "ngo-user-1" }, milestones: [], payments: [], auditLogs: [] };

  it("donor B cannot read donor A's contract; donor A can", async () => {
    db.contract.findUnique.mockResolvedValue(contract);
    as("donor-B", "DONOR");
    expect((await getContract(get(), { params: { id: "c-1" } })).status).toBe(403);
    as("donor-A", "DONOR");
    expect((await getContract(get(), { params: { id: "c-1" } })).status).toBe(200);
  });

  it("a member of another donor organisation cannot read it either", async () => {
    db.contract.findUnique.mockResolvedValue(contract);
    db.donorTeamMember.findUnique.mockResolvedValue({ accountId: "donor-C", role: "ADMIN" });
    as("someone", "DONOR");
    expect((await getContract(get(), { params: { id: "c-1" } })).status).toBe(403);
  });

  it("donor B cannot read donor A's CSR requirement", async () => {
    db.sponsorRequirement.findUnique.mockResolvedValue({ id: "req-1", sponsorId: "donor-A", status: "VALIDATED", extractedFields: {}, version: 1 });
    as("donor-B", "DONOR");
    expect([403, 404]).toContain((await getRequirement(get(), { params: { id: "req-1" } })).status);
  });
});

describe("NGO ↔ contract", () => {
  it("an NGO that is not party to the contract cannot read it", async () => {
    db.contract.findUnique.mockResolvedValue({ id: "c-1", donorId: "donor-A", ngoId: "ngo-1", ngo: { userId: "ngo-user-1" } });
    as("ngo-user-2", "NGO");
    expect((await getContract(get(), { params: { id: "c-1" } })).status).toBe(403);
  });
});

describe("admin-negative: donor and NGO sessions are refused by admin APIs", () => {
  const cases: Array<[string, () => Promise<any>, (mod: any) => Promise<Response>]> = [
    ["GET admin/audit/export", () => import("@/app/api/admin/audit/export/route"), (m) => m.GET(get("http://localhost/api/admin/audit/export"))],
    ["PATCH admin/finance/exceptions/[id]", () => import("@/app/api/admin/finance/exceptions/[id]/route"), (m) => m.PATCH(new Request("http://localhost", { method: "PATCH", body: "{}" }), { params: { id: "x" } })],
    ["POST admin/allocations", () => import("@/app/api/admin/allocations/route"), (m) => m.POST(new Request("http://localhost", { method: "POST", body: "{}" }))],
    ["POST admin/donors/[id]/org-review", () => import("@/app/api/admin/donors/[id]/org-review/route"), (m) => m.POST(new Request("http://localhost", { method: "POST", body: "{}" }), { params: { id: "x" } })],
    ["PATCH admin/outcome-claims/[id]", () => import("@/app/api/admin/outcome-claims/[id]/route"), (m) => m.PATCH(new Request("http://localhost", { method: "PATCH", body: "{}" }), { params: { id: "x" } })],
    ["PATCH admin/field-evidence/[id]", () => import("@/app/api/admin/field-evidence/[id]/route"), (m) => m.PATCH(new Request("http://localhost", { method: "PATCH", body: "{}" }), { params: { id: "x" } })],
    ["POST admin/ops/[job]/run", () => import("@/app/api/admin/ops/[job]/run/route"), (m) => m.POST(new Request("http://localhost", { method: "POST" }), { params: { job: "re-engagement" } })],
  ];

  for (const role of ["DONOR", "NGO"]) {
    for (const [name, load, call] of cases) {
      it(`${role} → ${name} is 403`, async () => {
        as(`${role.toLowerCase()}-1`, role);
        const res = await call(await load());
        expect(res.status).toBe(403);
      });
    }
  }

  it("no session at all is 401", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const m = await import("@/app/api/admin/audit/export/route");
    expect((await m.GET(get("http://localhost/api/admin/audit/export"))).status).toBe(401);
  });
});
