import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Contract amounts are exact Decimals end to end. They used to go through
 * Number() and a 0.01 tolerance, so a grant could be created whose milestones
 * did not add up to it, and a malformed amount became NaN instead of a 400.
 */

const db = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  donorTeamMember: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "donor-1", role: "DONOR" } })) }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));

import { createContract, parseRupees } from "@/lib/contract-service";
import { POST } from "@/app/api/contracts/route";

const D = (v: string | number) => new Prisma.Decimal(v);
const base = {
  donorId: "donor-1",
  ngoId: "ngo-1",
  projectId: "p-1",
  title: "Grant",
  termsAndConditions: "Terms",
  actorId: "donor-1",
  actorRole: "DONOR" as const,
};

describe("parseRupees", () => {
  it("accepts plain and Indian-grouped amounts with up to two decimals", () => {
    expect(parseRupees(120000)!.toFixed(2)).toBe("120000.00");
    expect(parseRupees("1,20,000.50")!.toFixed(2)).toBe("120000.50");
    expect(parseRupees("0.10")!.toFixed(2)).toBe("0.10");
  });

  it("refuses anything that is not a plain non-negative amount", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e6", "₹100", null, undefined, NaN, Infinity, {}]) {
      expect(parseRupees(bad)).toBeNull();
    }
  });
});

describe("createContract: milestones must equal the grant exactly", () => {
  beforeEach(() => vi.clearAllMocks());

  it("0.10 + 0.20 equals 0.30 exactly (a float sum would not)", async () => {
    db.$transaction.mockResolvedValue({ id: "c-1" });
    await expect(
      createContract({ ...base, totalGrantAmount: D("0.30"), milestones: [{ title: "a", description: "", allocatedAmount: D("0.10") }, { title: "b", description: "", allocatedAmount: D("0.20") }] })
    ).resolves.toBeDefined();
  });

  it("a one-paisa difference is refused (there is no tolerance)", async () => {
    await expect(
      createContract({ ...base, totalGrantAmount: D("100000.00"), milestones: [{ title: "a", description: "", allocatedAmount: D("99999.99") }] })
    ).rejects.toThrow(/must equal/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a zero grant is refused", async () => {
    await expect(createContract({ ...base, totalGrantAmount: D(0), milestones: [{ title: "a", description: "", allocatedAmount: D(0) }] })).rejects.toThrow(/greater than zero/);
  });
});

describe("POST /api/contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.project.findUnique.mockResolvedValue({ id: "p-1", ngoId: "ngo-1", ngo: {} });
  });
  const post = (body: unknown) => POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }));
  const ok = { projectId: "p-1", title: "Grant", termsAndConditions: "Terms", totalGrantAmount: "100000", milestones: [{ title: "a", allocatedAmount: "100000" }] };

  it("a malformed grant or milestone amount is a 400, never NaN in the database", async () => {
    expect((await post({ ...ok, totalGrantAmount: "1 lakh" })).status).toBe(400);
    expect((await post({ ...ok, milestones: [{ title: "a", allocatedAmount: "lots" }] })).status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
