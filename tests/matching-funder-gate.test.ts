import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: { user: { findUnique: vi.fn() } },
}));

import prisma from "@/lib/prisma";
import { checkFunderEligibility } from "@/lib/matching/funder";

const prismaMock = prisma as any;

/**
 * Who is allowed to stand behind an opportunity.
 *
 * The asymmetry this closes: lib/matching/runner.ts will not put an NGO in
 * front of a funder unless the NGO is VERIFIED, but a funder used to reach an
 * NGO on one employee's PAN with nobody having checked the company at all.
 */
function funder(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    name: "Suryodaya CSR Manager",
    email: "csr.manager@example.test",
    companyName: "Suryodaya Industries Limited",
    role: "DONOR",
    donorPersona: "CSR_OFFICER",
    panStatus: "VERIFIED",
    orgVerificationStatus: "VERIFIED",
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("checkFunderEligibility", () => {
  it("accepts a fully verified corporate funder", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder());
    const r = await checkFunderEligibility("user_1");
    expect(r.ok).toBe(true);
    expect(r.displayName).toBe("Suryodaya Industries Limited");
  });

  it("accepts a verified foundation — a trust has no CIN and must not need one", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      funder({ donorPersona: "FOUNDATION", companyName: "Vaibhavi Charitable Foundation" })
    );
    await expect(checkFunderEligibility("user_1")).resolves.toMatchObject({ ok: true });
  });

  it("accepts a verified government body", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder({ donorPersona: "GOVERNMENT" }));
    await expect(checkFunderEligibility("user_1")).resolves.toMatchObject({ ok: true });
  });
});

describe("checkFunderEligibility — the organisation gate", () => {
  it("REFUSES a funder whose organisation was never submitted", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder({ orgVerificationStatus: "NOT_SUBMITTED" }));
    const r = await checkFunderEligibility("user_1");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ORG_NOT_VERIFIED");
    // The remedy is the donor's, so the message must point there.
    expect(r.message).toContain("complete their profile");
  });

  it("REFUSES a funder whose organisation is still in the queue", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder({ orgVerificationStatus: "PENDING" }));
    const r = await checkFunderEligibility("user_1");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ORG_NOT_VERIFIED");
    // This one the admin can fix themselves — do not send them to the donor.
    expect(r.message).toContain("verification queue");
  });

  it("REFUSES a funder whose organisation was rejected", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder({ orgVerificationStatus: "REJECTED" }));
    const r = await checkFunderEligibility("user_1");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ORG_NOT_VERIFIED");
    expect(r.message).toContain("rejected");
  });

  it("does not let a verified PAN stand in for a verified organisation", async () => {
    // Exactly the hole this closes: the person checks out, the company does not.
    prismaMock.user.findUnique.mockResolvedValue(
      funder({ panStatus: "VERIFIED", orgVerificationStatus: "NOT_SUBMITTED" })
    );
    await expect(checkFunderEligibility("user_1")).resolves.toMatchObject({ ok: false });
  });

  it("does not let a verified organisation stand in for a verified PAN either", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      funder({ panStatus: "UNVERIFIED", orgVerificationStatus: "VERIFIED" })
    );
    const r = await checkFunderEligibility("user_1");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NOT_VERIFIED");
  });

  it("reports the PAN gate before the organisation gate when both fail", async () => {
    // Two different people fix these, so they are reported one at a time.
    prismaMock.user.findUnique.mockResolvedValue(
      funder({ panStatus: "UNVERIFIED", orgVerificationStatus: "NOT_SUBMITTED" })
    );
    expect((await checkFunderEligibility("user_1")).reason).toBe("NOT_VERIFIED");
  });
});

describe("checkFunderEligibility — the pre-existing gates still hold", () => {
  it("refuses a missing account", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect((await checkFunderEligibility("nope")).reason).toBe("NOT_FOUND");
  });

  it("refuses a non-donor account", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder({ role: "NGO" }));
    expect((await checkFunderEligibility("user_1")).reason).toBe("NOT_A_DONOR");
  });

  it("refuses an individual donor however verified they are", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder({ donorPersona: "INDIVIDUAL" }));
    expect((await checkFunderEligibility("user_1")).reason).toBe("NOT_INSTITUTIONAL");
  });

  it("refuses an HNI donor — a large giver is not an institution", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder({ donorPersona: "HNI" }));
    expect((await checkFunderEligibility("user_1")).reason).toBe("NOT_INSTITUTIONAL");
  });

  it("reads orgVerificationStatus from the database rather than assuming it", async () => {
    prismaMock.user.findUnique.mockResolvedValue(funder());
    await checkFunderEligibility("user_1");
    expect(prismaMock.user.findUnique.mock.calls[0][0].select).toMatchObject({
      orgVerificationStatus: true,
    });
  });
});
