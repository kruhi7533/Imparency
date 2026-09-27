import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    donation: { findMany: vi.fn() },
    fraudAlert: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/fraud-alerts", () => ({ createFraudAlert: vi.fn() }));

import prisma from "@/lib/prisma";
import { createFraudAlert } from "@/lib/fraud-alerts";
import { checkCsrBudgetOverrun } from "@/lib/risk-agent";

const prismaMock = prisma as any;

function donor(overrides: Record<string, unknown> = {}) {
  return {
    donorPersona: "CSR_OFFICER",
    csrBudget: 5000000,
    trustAnnualBudget: null,
    ...overrides,
  };
}

/** Donations the FY-windowed query returns. */
function given(...amounts: number[]) {
  prismaMock.donation.findMany.mockResolvedValue(amounts.map((amount) => ({ amount })));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.fraudAlert.findFirst.mockResolvedValue(null);
  given();
});

/**
 * What this check used to get wrong.
 *
 * It compared `totalDonated` — a LIFETIME running total — against what is
 * normally an ANNUAL declared figure, used a 2x multiplier to compensate, and
 * returned early for anyone who was not a CSR_OFFICER. So a foundation was
 * never checked at all, and a CSR officer could give double its declared budget
 * before anything fired.
 */
describe("checkCsrBudgetOverrun", () => {
  it("alerts once giving passes the declared budget", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor());
    given(3000000, 2500000); // 55L against a 50L budget

    await checkCsrBudgetOverrun("donor_1");

    expect(createFraudAlert).toHaveBeenCalledWith(
      "CSR_BUDGET_EXCEEDED",
      "donor_1",
      "DONOR",
      expect.stringContaining("lawful"),
      "MEDIUM",
      "FRAUD_ALERT"
    );
  });

  it("fires at the budget, NOT at twice it", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor());
    given(7000000); // 70L — 140% of budget, under the old 2x threshold
    await checkCsrBudgetOverrun("donor_1");
    expect(createFraudAlert).toHaveBeenCalled();
  });

  it("counts only the financial year, not a lifetime total", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor());
    await checkCsrBudgetOverrun("donor_1");
    const where = prismaMock.donation.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("SUCCESS");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    // A half-open window, so 1 April midnight is not double-counted.
    expect(where.createdAt.lt.getTime()).toBeGreaterThan(where.createdAt.gte.getTime());
  });

  it("NO LONGER exempts foundations — they declare trustAnnualBudget", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      donor({ donorPersona: "FOUNDATION", csrBudget: null, trustAnnualBudget: 2000000 })
    );
    given(2500000);
    await checkCsrBudgetOverrun("donor_1");
    expect(createFraudAlert).toHaveBeenCalled();
  });

  it("stays silent for a donor within budget", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor());
    given(1000000);
    await checkCsrBudgetOverrun("donor_1");
    expect(createFraudAlert).not.toHaveBeenCalled();
  });

  it("stays silent at exactly the declared budget", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor());
    given(5000000);
    await checkCsrBudgetOverrun("donor_1");
    expect(createFraudAlert).not.toHaveBeenCalled();
  });

  it("stays silent when no budget was declared — nothing to compare against", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor({ csrBudget: null }));
    given(9000000);
    await checkCsrBudgetOverrun("donor_1");
    expect(createFraudAlert).not.toHaveBeenCalled();
    // And does not even run the aggregate — no budget, no question to answer.
    expect(prismaMock.donation.findMany).not.toHaveBeenCalled();
  });

  it("stays silent for an individual donor", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor({ donorPersona: "INDIVIDUAL" }));
    given(9000000);
    await checkCsrBudgetOverrun("donor_1");
    expect(createFraudAlert).not.toHaveBeenCalled();
  });

  it("does not re-alert while an alert is already open", async () => {
    prismaMock.user.findUnique.mockResolvedValue(donor());
    given(9000000);
    prismaMock.fraudAlert.findFirst.mockResolvedValue({ id: "alert_1" });
    await checkCsrBudgetOverrun("donor_1");
    expect(createFraudAlert).not.toHaveBeenCalled();
  });

  it("never throws — it runs inside a payment webhook", async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("db down"));
    await expect(checkCsrBudgetOverrun("donor_1")).resolves.toBeUndefined();
  });

  it("does nothing for a donor that no longer exists", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await checkCsrBudgetOverrun("donor_1");
    expect(createFraudAlert).not.toHaveBeenCalled();
  });
});
