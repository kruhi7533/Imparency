import { describe, it, expect, vi } from "vitest";

// The engine is pure and must never reach a database. This mock exists only to
// break the import chain if someone later adds a Prisma import to rules.ts or
// eligibility.ts — it should stay unused. A test failing because this object is
// empty is the point, not a bug.
vi.mock("@/lib/prisma", () => ({ default: {} }));

import { evaluateEligibility } from "@/lib/matching/eligibility";
import type { CriterionSpec, EligibilityInput } from "@/lib/matching/types";

/**
 * What these tests protect.
 *
 * The engine decides who a funder is shown, so its failure modes are not
 * cosmetic. Three invariants matter more than the rules themselves:
 *
 *  1. "We could not check" must never render as "we checked and it passed".
 *     A null health score, an organisation nobody has analysed, geography that
 *     was never resolved — all UNKNOWN, never PASS.
 *  2. A criterion the opportunity did not declare must not be evaluated at all.
 *     This is what stops a domestic grant silently rejecting every organisation
 *     without an FCRA.
 *  3. An opportunity with no criteria must not make the entire platform
 *     eligible.
 */

function evidence(overrides: Partial<EligibilityInput["evidence"]> = {}): EligibilityInput["evidence"] {
  return {
    earned: {
      panVerified: true,
      registrationVerified: true,
      a12Verified: true,
      eightyGVerified: true,
    },
    outstanding: [],
    noExtraction: false,
    ...overrides,
  };
}

function ngo(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    ngoId: "ngo_1",
    verificationStatus: "VERIFIED",
    isSuspended: false,
    causeCategories: ["Education"],
    foundedYear: 2015,
    healthScore: 80,
    evidence: evidence(),
    fcraStatus: "NONE",
    projects: [{ id: "p1", status: "ACTIVE", causeCategory: "Education", stateName: "Maharashtra" }],
    asOf: new Date("2026-09-08T00:00:00.000Z"),
    ...overrides,
  };
}

function spec(kind: string, over: Partial<CriterionSpec> = {}): CriterionSpec {
  return { kind, value: null, values: [], required: true, ...over };
}

const outcomeOf = (r: ReturnType<typeof evaluateEligibility>, code: string) =>
  r.results.find((x) => x.code === code)?.outcome;

describe("evaluateEligibility — verdict aggregation", () => {
  it("returns UNKNOWN, never ELIGIBLE, when the opportunity declares no criteria", () => {
    const result = evaluateEligibility(ngo(), []);
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.results).toEqual([]);
  });

  it("is ELIGIBLE only when every required criterion passes", () => {
    const result = evaluateEligibility(ngo(), [
      spec("VERIFIED_STATUS"),
      spec("NOT_SUSPENDED"),
      spec("CAUSE_CATEGORY", { values: ["Education"] }),
      spec("COMPLIANCE_FLAG_80G"),
      spec("MIN_YEARS_ACTIVE", { value: "5" }),
    ]);
    expect(result.verdict).toBe("ELIGIBLE");
    expect(result.results).toHaveLength(5);
    expect(result.results.every((r) => r.outcome === "PASS")).toBe(true);
  });

  it("lets a definite FAIL outrank an UNKNOWN — we know enough to decide", () => {
    const result = evaluateEligibility(ngo({ healthScore: null, isSuspended: true }), [
      spec("NOT_SUSPENDED"),
      spec("MIN_HEALTH_SCORE", { value: "60" }),
    ]);
    expect(outcomeOf(result, "NOT_SUSPENDED")).toBe("FAIL");
    expect(outcomeOf(result, "MIN_HEALTH_SCORE")).toBe("UNKNOWN");
    expect(result.verdict).toBe("INELIGIBLE");
  });

  it("does not let a non-required failure change the verdict", () => {
    const result = evaluateEligibility(ngo({ causeCategories: ["Healthcare"], projects: [] }), [
      spec("VERIFIED_STATUS"),
      spec("CAUSE_CATEGORY", { values: ["Education"], required: false }),
    ]);
    expect(outcomeOf(result, "CAUSE_CATEGORY")).toBe("FAIL");
    expect(result.verdict).toBe("ELIGIBLE");
    expect(result.summary).toContain("preferred");
  });

  it("evaluates ONLY declared criteria — an undeclared one is absent entirely", () => {
    // The domestic-grant invariant: no FCRA criterion means FCRA is never
    // considered, even though this organisation holds none.
    const result = evaluateEligibility(ngo({ fcraStatus: "NONE" }), [spec("VERIFIED_STATUS")]);
    expect(result.results.map((r) => r.code)).toEqual(["VERIFIED_STATUS"]);
    expect(result.verdict).toBe("ELIGIBLE");
  });

  it("surfaces an unrecognised criterion as UNKNOWN rather than dropping it", () => {
    const result = evaluateEligibility(ngo(), [spec("SOME_FUTURE_RULE")]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].outcome).toBe("UNKNOWN");
    expect(result.verdict).toBe("UNKNOWN");
  });
});

describe("no evidence must never read as safe", () => {
  it("returns UNKNOWN — not PASS, not FAIL — when nobody has analysed the documents", () => {
    const result = evaluateEligibility(
      ngo({ evidence: evidence({ noExtraction: true, earned: {
        panVerified: false, registrationVerified: false, a12Verified: false, eightyGVerified: false,
      } }) }),
      [spec("COMPLIANCE_FLAG_80G")]
    );
    expect(outcomeOf(result, "COMPLIANCE_FLAG_80G")).toBe("UNKNOWN");
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.results[0].detail).toMatch(/never been analysed/i);
  });

  it("returns FAIL once extraction has run and found no 80G", () => {
    const result = evaluateEligibility(
      ngo({ evidence: evidence({ earned: {
        panVerified: true, registrationVerified: true, a12Verified: true, eightyGVerified: false,
      } }) }),
      [spec("COMPLIANCE_FLAG_80G")]
    );
    expect(outcomeOf(result, "COMPLIANCE_FLAG_80G")).toBe("FAIL");
    expect(result.verdict).toBe("INELIGIBLE");
  });

  it("words a missing optional credential as non-qualifying, not as a defect", () => {
    const result = evaluateEligibility(
      ngo({ evidence: evidence({ earned: {
        panVerified: true, registrationVerified: true, a12Verified: false, eightyGVerified: true,
      } }) }),
      [spec("COMPLIANCE_FLAG_12A")]
    );
    expect(result.results[0].detail).toMatch(/not a finding against them/i);
  });

  it("treats a never-calculated health score as UNKNOWN, never a silent pass", () => {
    const result = evaluateEligibility(ngo({ healthScore: null }), [
      spec("MIN_HEALTH_SCORE", { value: "60" }),
    ]);
    expect(outcomeOf(result, "MIN_HEALTH_SCORE")).toBe("UNKNOWN");
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("fails a health score that is genuinely below the threshold", () => {
    const result = evaluateEligibility(ngo({ healthScore: 40 }), [
      spec("MIN_HEALTH_SCORE", { value: "60" }),
    ]);
    expect(outcomeOf(result, "MIN_HEALTH_SCORE")).toBe("FAIL");
  });
});

describe("geography routes through projects, and never passes on absence", () => {
  it("is UNKNOWN when the organisation has no projects at all", () => {
    const result = evaluateEligibility(ngo({ projects: [] }), [
      spec("PROJECT_IN_STATE", { values: ["Karnataka"] }),
    ]);
    expect(outcomeOf(result, "PROJECT_IN_STATE")).toBe("UNKNOWN");
  });

  it("is UNKNOWN when projects exist but none has a resolved location", () => {
    const result = evaluateEligibility(
      ngo({ projects: [{ id: "p1", status: "ACTIVE", causeCategory: "Education", stateName: null }] }),
      [spec("PROJECT_IN_STATE", { values: ["Karnataka"] })]
    );
    expect(outcomeOf(result, "PROJECT_IN_STATE")).toBe("UNKNOWN");
  });

  it("fails only when a location is known and does not match", () => {
    const result = evaluateEligibility(ngo(), [spec("PROJECT_IN_STATE", { values: ["Karnataka"] })]);
    expect(outcomeOf(result, "PROJECT_IN_STATE")).toBe("FAIL");
  });
});

describe("rules read no globals", () => {
  it("computes years from the injected asOf, not the wall clock", () => {
    const criteria = [spec("MIN_YEARS_ACTIVE", { value: "5" })];
    const early = evaluateEligibility(
      ngo({ foundedYear: 2023, asOf: new Date("2026-01-01T00:00:00.000Z") }),
      criteria
    );
    const later = evaluateEligibility(
      ngo({ foundedYear: 2023, asOf: new Date("2040-01-01T00:00:00.000Z") }),
      criteria
    );
    expect(early.verdict).toBe("INELIGIBLE");
    expect(later.verdict).toBe("ELIGIBLE");
  });

  it("matches cause categories case- and whitespace-insensitively", () => {
    const result = evaluateEligibility(ngo({ causeCategories: ["  education  "] }), [
      spec("CAUSE_CATEGORY", { values: ["Education"] }),
    ]);
    expect(outcomeOf(result, "CAUSE_CATEGORY")).toBe("PASS");
  });
});
