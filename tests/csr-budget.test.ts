import { describe, it, expect } from "vitest";
import {
  NEAR_THRESHOLD,
  assessBudgetUtilisation,
  declaredAnnualBudget,
  describeUtilisation,
} from "@/lib/csr-budget";
import { financialYearRange, getFinancialYear } from "@/lib/finance-utils";

const CSR = { donorPersona: "CSR_OFFICER", csrBudget: 5000000, trustAnnualBudget: null };
const TRUST = { donorPersona: "FOUNDATION", csrBudget: null, trustAnnualBudget: 2000000 };

describe("declaredAnnualBudget", () => {
  it("reads csrBudget for a CSR officer", () => {
    expect(declaredAnnualBudget(CSR)).toBe(5000000);
  });

  it("reads trustAnnualBudget for a foundation", () => {
    // The regression that matters: the old check only ever read csrBudget and
    // bailed out for anyone who was not a CSR_OFFICER, so every foundation was
    // exempt from a check it appeared to be covered by.
    expect(declaredAnnualBudget(TRUST)).toBe(2000000);
  });

  it("does not read a CSR budget for a foundation, or vice versa", () => {
    expect(declaredAnnualBudget({ ...TRUST, csrBudget: 9999999 })).toBe(2000000);
    expect(declaredAnnualBudget({ ...CSR, trustAnnualBudget: 9999999 })).toBe(5000000);
  });

  it("returns null for personas with no budget concept", () => {
    for (const persona of ["INDIVIDUAL", "HNI", "GOVERNMENT", null]) {
      expect(declaredAnnualBudget({ ...CSR, donorPersona: persona })).toBeNull();
    }
  });

  it("treats a zero or negative declaration as ABSENT, not as a budget of zero", () => {
    // Otherwise every such donor sits permanently OVER on their first rupee.
    expect(declaredAnnualBudget({ ...CSR, csrBudget: 0 })).toBeNull();
    expect(declaredAnnualBudget({ ...CSR, csrBudget: -1 })).toBeNull();
  });

  it("accepts a Decimal-style string, since Prisma hands one back", () => {
    expect(declaredAnnualBudget({ ...CSR, csrBudget: "5000000" })).toBe(5000000);
  });
});

describe("assessBudgetUtilisation", () => {
  it("is WITHIN well under budget", () => {
    const u = assessBudgetUtilisation({ ...CSR, spent: 1000000 });
    expect(u.band).toBe("WITHIN");
    expect(u.percent).toBe(20);
  });

  it("is NEAR at the 90% threshold", () => {
    const u = assessBudgetUtilisation({ ...CSR, spent: 5000000 * NEAR_THRESHOLD });
    expect(u.band).toBe("NEAR");
  });

  it("is still NEAR at exactly the budget, not OVER", () => {
    // Spending your budget precisely is the intended outcome, not an anomaly.
    const u = assessBudgetUtilisation({ ...CSR, spent: 5000000 });
    expect(u.band).toBe("NEAR");
    expect(u.percent).toBe(100);
  });

  it("is OVER one rupee past the budget", () => {
    const u = assessBudgetUtilisation({ ...CSR, spent: 5000001 });
    expect(u.band).toBe("OVER");
  });

  it("fires at the budget, not at twice it", () => {
    // The old check used a 2x multiplier, so a donor could give double their
    // declared budget before anything at all happened.
    expect(assessBudgetUtilisation({ ...CSR, spent: 7500000 }).band).toBe("OVER");
  });

  it("applies the same bands to a foundation", () => {
    expect(assessBudgetUtilisation({ ...TRUST, spent: 2500000 }).band).toBe("OVER");
    expect(assessBudgetUtilisation({ ...TRUST, spent: 500000 }).band).toBe("WITHIN");
  });

  it("reports UNDECLARED rather than WITHIN when nothing was declared", () => {
    // No evidence must never render as a clean result.
    const u = assessBudgetUtilisation({ ...CSR, csrBudget: null, spent: 9000000 });
    expect(u.band).toBe("UNDECLARED");
    expect(u.declared).toBeNull();
    expect(u.percent).toBeNull();
  });

  it("does not report a declared budget of 0 — that would read as 'spent nothing'", () => {
    const u = assessBudgetUtilisation({ ...CSR, csrBudget: 0, spent: 100 });
    expect(u.declared).not.toBe(0);
    expect(u.declared).toBeNull();
  });

  it("labels the assessment with the financial year it covers", () => {
    const asOf = new Date("2026-06-15T00:00:00.000Z");
    expect(assessBudgetUtilisation({ ...CSR, spent: 0, asOf }).financialYear).toBe(
      getFinancialYear(asOf)
    );
  });

  it("survives a non-finite spend without throwing", () => {
    expect(assessBudgetUtilisation({ ...CSR, spent: NaN }).spent).toBe(0);
  });
});

describe("describeUtilisation", () => {
  it("says over-spending is lawful, so nobody reads the alert as fraud", () => {
    const text = describeUtilisation(assessBudgetUtilisation({ ...CSR, spent: 6000000 }));
    expect(text).toContain("lawful");
    expect(text).toContain("out of date");
  });

  it("does not claim a comparison when nothing was declared", () => {
    const text = describeUtilisation(
      assessBudgetUtilisation({ ...CSR, csrBudget: null, spent: 100 })
    );
    expect(text).toContain("No annual budget declared");
  });

  it("formats money in the Indian grouping", () => {
    const text = describeUtilisation(assessBudgetUtilisation({ ...CSR, spent: 2500000 }));
    expect(text).toContain("25,00,000");
  });
});

describe("financialYearRange", () => {
  it("starts on 1 April for a date after April", () => {
    const { start, end } = financialYearRange(new Date(2026, 5, 15)); // 15 Jun 2026
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3);
    expect(end.getFullYear()).toBe(2027);
  });

  it("puts January back in the year that began the previous April", () => {
    const { start } = financialYearRange(new Date(2027, 0, 10)); // 10 Jan 2027
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3);
  });

  it("is half-open, so 1 April midnight belongs to the NEW year only", () => {
    const boundary = new Date(2027, 3, 1);
    const previous = financialYearRange(new Date(2026, 5, 1));
    const current = financialYearRange(boundary);
    // Excluded from the old range, included in the new — never both.
    expect(boundary.getTime()).toBe(previous.end.getTime());
    expect(boundary.getTime()).toBe(current.start.getTime());
  });

  it("agrees with getFinancialYear about which year a date is in", () => {
    for (const d of [new Date(2026, 3, 1), new Date(2026, 11, 31), new Date(2027, 2, 31)]) {
      const { start } = financialYearRange(d);
      expect(getFinancialYear(d).startsWith(String(start.getFullYear()))).toBe(true);
    }
  });
});
