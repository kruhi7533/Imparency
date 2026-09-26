import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Deterministic donor-side fraud rules (lib/risk-agent.ts), added instead of
 * folding these checks into the NGO fraud-investigator agent: CSR-registration
 * format, CSR-budget overrun, and donation structuring are all checkable with a
 * threshold/regex — none of them need an LLM's judgment the way "are these two
 * NGOs actually related" does. See the corresponding session discussion.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  donation: { findMany: vi.fn() },
  fraudAlert: { create: vi.fn(), findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/fraud-investigator/trigger", () => ({ maybeInvestigate: vi.fn() }));

import { checkCsrRegistrationFormat, checkCsrBudgetOverrun, checkDonationStructuring } from "@/lib/risk-agent";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.fraudAlert.create.mockResolvedValue({ id: "alert-1" });
  prismaMock.fraudAlert.findFirst.mockResolvedValue(null);
});

describe("checkCsrRegistrationFormat", () => {
  it("flags a registration number that doesn't match the MCA CSR-1 format", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ donorPersona: "CSR_OFFICER", csrRegistrationNumber: "asdf1234" });

    await checkCsrRegistrationFormat("donor-1");

    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(1);
    const created = prismaMock.fraudAlert.create.mock.calls[0][0].data;
    expect(created.type).toBe("CSR_REGISTRATION_INVALID_FORMAT");
    expect(created.severity).toBe("LOW");
    expect(created.entityType).toBe("DONOR");
  });

  it("accepts a correctly formatted CSR-1 number", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ donorPersona: "CSR_OFFICER", csrRegistrationNumber: "CSR00012345" });

    await checkCsrRegistrationFormat("donor-1");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("skips donors who aren't declared CSR_OFFICER — a non-CSR donor's free-text field is nobody's business", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ donorPersona: "INDIVIDUAL", csrRegistrationNumber: "garbage" });

    await checkCsrRegistrationFormat("donor-1");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("treats a blank number as a completeness gap, not a format defect — not this check's job", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ donorPersona: "CSR_OFFICER", csrRegistrationNumber: "" });

    await checkCsrRegistrationFormat("donor-1");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("never throws — a fraud check must not break a profile save", async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("db down"));
    await expect(checkCsrRegistrationFormat("donor-1")).resolves.toBeUndefined();
  });
});

/**
 * These assertions changed deliberately.
 *
 * They used to pin a lifetime-total-vs-2x-annual-budget comparison, which the
 * implementation itself documented as not like-for-like. The check now sums the
 * current FINANCIAL YEAR and fires at the declared budget rather than twice it,
 * so "under the 2x threshold" is no longer a thing to be under. Deeper coverage
 * of the new bands lives in tests/csr-budget-overrun.test.ts and
 * tests/csr-budget.test.ts; what stays here is the shape of the alert.
 */
describe("checkCsrBudgetOverrun", () => {
  it("flags this financial year's donations exceeding the declared CSR budget", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ donorPersona: "CSR_OFFICER", csrBudget: 100_000, trustAnnualBudget: null });
    prismaMock.donation.findMany.mockResolvedValue([{ amount: 150_000 }]);

    await checkCsrBudgetOverrun("donor-1");

    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(1);
    const created = prismaMock.fraudAlert.create.mock.calls[0][0].data;
    expect(created.type).toBe("CSR_BUDGET_EXCEEDED");
    expect(created.severity).toBe("MEDIUM");
  });

  it("does not flag a donor still inside their declared budget", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ donorPersona: "CSR_OFFICER", csrBudget: 100_000, trustAnnualBudget: null });
    prismaMock.donation.findMany.mockResolvedValue([{ amount: 40_000 }]);

    await checkCsrBudgetOverrun("donor-1");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("skips donors with no declared budget — nothing to compare against", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ donorPersona: "CSR_OFFICER", csrBudget: null, trustAnnualBudget: null });

    await checkCsrBudgetOverrun("donor-1");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("does not re-alert every donation once already flagged and open", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ donorPersona: "CSR_OFFICER", csrBudget: 100_000, trustAnnualBudget: null });
    prismaMock.donation.findMany.mockResolvedValue([{ amount: 250_000 }]);
    prismaMock.fraudAlert.findFirst.mockResolvedValue({ id: "existing-alert" });

    await checkCsrBudgetOverrun("donor-1");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });
});

describe("checkDonationStructuring", () => {
  it("flags 3+ donations to the same NGO within 30 days totalling over the threshold", async () => {
    prismaMock.donation.findMany.mockResolvedValue([{ amount: 80_000 }, { amount: 70_000 }, { amount: 60_000 }]);

    await checkDonationStructuring("donor-1", "ngo-1");

    expect(prismaMock.fraudAlert.create).toHaveBeenCalledTimes(1);
    const created = prismaMock.fraudAlert.create.mock.calls[0][0].data;
    expect(created.type).toBe("DONATION_STRUCTURING_PATTERN");
    expect(created.severity).toBe("MEDIUM");
  });

  it("does not flag a single large legitimate donation — total alone is not the signal", async () => {
    prismaMock.donation.findMany.mockResolvedValue([{ amount: 500_000 }]);

    await checkDonationStructuring("donor-1", "ngo-1");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("does not flag several small donations that stay under the total threshold", async () => {
    prismaMock.donation.findMany.mockResolvedValue([{ amount: 1000 }, { amount: 1500 }, { amount: 2000 }]);

    await checkDonationStructuring("donor-1", "ngo-1");

    expect(prismaMock.fraudAlert.create).not.toHaveBeenCalled();
  });

  it("scopes the lookup to this donor, this NGO, successful donations, and the 30-day window", async () => {
    prismaMock.donation.findMany.mockResolvedValue([]);

    await checkDonationStructuring("donor-1", "ngo-1");

    const where = prismaMock.donation.findMany.mock.calls[0][0].where;
    expect(where.donorId).toBe("donor-1");
    expect(where.status).toBe("SUCCESS");
    expect(where.project).toEqual({ ngoId: "ngo-1" });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("never throws — a fraud check must not break payment confirmation", async () => {
    prismaMock.donation.findMany.mockRejectedValue(new Error("db down"));
    await expect(checkDonationStructuring("donor-1", "ngo-1")).resolves.toBeUndefined();
  });
});
