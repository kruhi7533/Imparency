import { describe, it, expect } from "vitest";
import { assertTransition, canTransition } from "@/lib/requirements/status";
import { RequirementWorkflowError } from "@/lib/requirements/errors";

function statusOf(fn: () => void): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof RequirementWorkflowError ? e.status : -1;
  }
}

describe("requirement state machine", () => {
  it("allows the documented happy path, each step by the right actor", () => {
    expect(canTransition("UPLOADED", "PROCESSING", "SYSTEM")).toBe(true);
    expect(canTransition("PROCESSING", "AI_EXTRACTED", "SYSTEM")).toBe(true);
    expect(canTransition("AI_EXTRACTED", "DONOR_REVIEW", "DONOR")).toBe(true);
    expect(canTransition("DONOR_REVIEW", "PENDING_ADMIN_REVIEW", "DONOR")).toBe(true);
    expect(canTransition("PENDING_ADMIN_REVIEW", "VALIDATED", "ADMIN")).toBe(true);
    expect(canTransition("VALIDATED", "MATCHING", "DONOR")).toBe(true);
    expect(canTransition("MATCHING", "SHORTLISTED", "SYSTEM")).toBe(true);
    expect(canTransition("SHORTLISTED", "NGO_RESPONSE", "NGO")).toBe(true);
    expect(canTransition("NGO_RESPONSE", "SELECTED", "DONOR")).toBe(true);
    expect(canTransition("SELECTED", "CONTRACTED", "DONOR")).toBe(true);
  });

  it("allows failure and correction branches", () => {
    expect(canTransition("PROCESSING", "FAILED", "SYSTEM")).toBe(true);
    expect(canTransition("FAILED", "PROCESSING", "DONOR")).toBe(true);
    expect(canTransition("PENDING_ADMIN_REVIEW", "NEEDS_CORRECTION", "ADMIN")).toBe(true);
    expect(canTransition("NEEDS_CORRECTION", "PENDING_ADMIN_REVIEW", "DONOR")).toBe(true);
    expect(canTransition("PENDING_ADMIN_REVIEW", "REJECTED", "ADMIN")).toBe(true);
  });

  it("never lets a donor validate, and never skips the admin gate", () => {
    expect(canTransition("PENDING_ADMIN_REVIEW", "VALIDATED", "DONOR")).toBe(false);
    expect(canTransition("DONOR_REVIEW", "VALIDATED", "DONOR")).toBe(false);
    expect(canTransition("DONOR_REVIEW", "VALIDATED", "ADMIN")).toBe(false);
    expect(canTransition("AI_EXTRACTED", "VALIDATED", "ADMIN")).toBe(false);
  });

  it.each(["UPLOADED", "AI_EXTRACTED", "DONOR_REVIEW", "PENDING_ADMIN_REVIEW", "NEEDS_CORRECTION", "REJECTED"] as const)(
    "cannot start matching from %s",
    (from) => {
      expect(canTransition(from, "MATCHING", "DONOR")).toBe(false);
      expect(canTransition(from, "MATCHING", "ADMIN")).toBe(false);
    }
  );

  it("rejects illegal transitions with 400 and wrong-role transitions with 403", () => {
    expect(statusOf(() => assertTransition("UPLOADED", "VALIDATED", "ADMIN"))).toBe(400);
    expect(statusOf(() => assertTransition("PENDING_ADMIN_REVIEW", "VALIDATED", "DONOR"))).toBe(403);
    expect(statusOf(() => assertTransition("PENDING_ADMIN_REVIEW", "VALIDATED", "ADMIN"))).toBeNull();
  });

  it("treats CONTRACTED and REJECTED as terminal", () => {
    for (const to of ["VALIDATED", "PROCESSING", "SELECTED"] as const) {
      expect(canTransition("CONTRACTED", to, "ADMIN")).toBe(false);
      expect(canTransition("REJECTED", to, "ADMIN")).toBe(false);
    }
  });
});
