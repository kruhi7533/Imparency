import { describe, it, expect } from "vitest";
import {
  BUDGET_VIOLATION_STATUSES,
  isBudgetViolation,
  normalizeBudgetStatus,
  parseValidationResult,
  getBudgetVerdict,
} from "@/lib/budget-rule";

// budget-rule.ts is the single source of truth for the strict budget rule: the
// admin UI decides whether to demand a justification from it, and the
// review-proof API enforces the same call. These tests pin that shared contract
// so the two can't drift apart.

describe("the strict budget rule", () => {
  it("treats exactly OVER_BUDGET / NO_EVIDENCE / UNCLEAR as violations", () => {
    expect(BUDGET_VIOLATION_STATUSES).toEqual(["OVER_BUDGET", "NO_EVIDENCE", "UNCLEAR"]);
  });

  it("lets clean statuses through", () => {
    expect(isBudgetViolation("ALIGNED")).toBe(false);
    expect(isBudgetViolation("UNDER_BUDGET")).toBe(false);
  });

  it("flags every violating status", () => {
    expect(isBudgetViolation("OVER_BUDGET")).toBe(true);
    expect(isBudgetViolation("NO_EVIDENCE")).toBe(true);
    expect(isBudgetViolation("UNCLEAR")).toBe(true);
  });

  it("does not flag an absent status — proofs predating budget validation are not violations", () => {
    expect(isBudgetViolation(null)).toBe(false);
    expect(isBudgetViolation(undefined)).toBe(false);
    expect(isBudgetViolation("")).toBe(false);
  });
});

describe("normalizeBudgetStatus", () => {
  it("accepts known statuses case-insensitively", () => {
    expect(normalizeBudgetStatus("ALIGNED")).toBe("ALIGNED");
    expect(normalizeBudgetStatus("over_budget")).toBe("OVER_BUDGET");
    expect(normalizeBudgetStatus("  no_evidence  ")).toBe("NO_EVIDENCE");
  });

  it("fails closed to UNCLEAR on anything unrecognized", () => {
    // UNCLEAR is itself a violation, so a garbled model response demands a
    // justification rather than silently passing the budget gate.
    expect(normalizeBudgetStatus("WEIRD")).toBe("UNCLEAR");
    expect(normalizeBudgetStatus(null)).toBe("UNCLEAR");
    expect(normalizeBudgetStatus(42)).toBe("UNCLEAR");
    expect(isBudgetViolation(normalizeBudgetStatus("WEIRD"))).toBe(true);
  });
});

describe("parseValidationResult", () => {
  it("returns null for empty input instead of throwing", () => {
    expect(parseValidationResult(null)).toBeNull();
    expect(parseValidationResult(undefined)).toBeNull();
    expect(parseValidationResult("")).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseValidationResult("{not json")).toBeNull();
  });

  it("returns null for JSON that isn't an object", () => {
    expect(parseValidationResult("42")).toBeNull();
    expect(parseValidationResult("null")).toBeNull();
  });

  it("parses a well-formed object", () => {
    expect(parseValidationResult('{"score":80}')).toEqual({ score: 80 });
  });
});

describe("getBudgetVerdict", () => {
  it("returns null when the proof records no budget status", () => {
    expect(getBudgetVerdict('{"score":80}')).toBeNull();
    expect(getBudgetVerdict(null)).toBeNull();
  });

  it("returns null rather than throwing on a corrupt result column", () => {
    expect(getBudgetVerdict("{broken")).toBeNull();
  });

  it("extracts the full verdict", () => {
    expect(
      getBudgetVerdict(
        '{"budgetStatus":"OVER_BUDGET","budgetClaimedAmount":5000,"budgetReasoning":"receipts total 5000"}'
      )
    ).toEqual({ status: "OVER_BUDGET", claimed: 5000, reasoning: "receipts total 5000" });
  });

  it("defaults a missing amount and reasoning without inventing values", () => {
    expect(getBudgetVerdict('{"budgetStatus":"NO_EVIDENCE"}')).toEqual({
      status: "NO_EVIDENCE",
      claimed: null,
      reasoning: "",
    });
  });

  it("does not trust a non-numeric claimed amount", () => {
    // A stringified amount would render as "₹5000" via toLocaleString on a
    // string and silently bypass the numeric check — keep it null.
    expect(getBudgetVerdict('{"budgetStatus":"ALIGNED","budgetClaimedAmount":"5000"}')?.claimed).toBeNull();
  });

  it("gives the admin UI and the API the same verdict for one stored proof", () => {
    const stored = '{"budgetStatus":"NO_EVIDENCE","budgetClaimedAmount":null}';
    const uiVerdict = isBudgetViolation(getBudgetVerdict(stored)?.status);
    const apiVerdict = isBudgetViolation(getBudgetVerdict(stored)?.status ?? null);
    expect(uiVerdict).toBe(true);
    expect(apiVerdict).toBe(uiVerdict);
  });
});
