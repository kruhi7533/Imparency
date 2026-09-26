import { describe, it, expect, vi } from "vitest";

/**
 * What happens when evidence gathered after approval contradicts it.
 *
 * The property these exist to protect is the boundary, not the wording: this
 * policy re-opens a decision and never takes one. If a future change makes any
 * of these return something that suspends, delists, or rejects, that is a
 * different product and it should not slip in under a test suite that still
 * passes.
 */

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { decideReversal, REVERIFICATION_WINDOW_DAYS } from "@/lib/verification-reversal";
import type { TriageFinding } from "@/lib/verification-triage";

const finding = (
  severity: "LOW" | "MEDIUM" | "HIGH",
  fieldKey: string | null,
  issue = "something"
): TriageFinding => ({ severity, fieldKey, issue });

describe("decideReversal", () => {
  it("only ever re-opens — it has no action that acts against an organisation", () => {
    const cases: TriageFinding[][] = [
      [finding("HIGH", "panNumber")],
      [finding("HIGH", "eightyGNumber")],
      [finding("MEDIUM", "a12Number"), finding("MEDIUM", "orgName")],
      [],
    ];
    for (const findings of cases) {
      const decision = decideReversal({ verificationStatus: "VERIFIED", hasEvidence: true, findings });
      expect(["NONE", "REOPEN"]).toContain(decision.action);
    }
  });

  it("re-opens on an identity contradiction and says which field", () => {
    const decision = decideReversal({
      verificationStatus: "VERIFIED",
      hasEvidence: true,
      findings: [finding("HIGH", "panNumber", "PAN on document does not match the form")],
    });
    expect(decision.action).toBe("REOPEN");
    expect(decision.severity).toBe("IDENTITY");
    expect(decision.reason).toContain("panNumber");
  });

  it("treats a serious NON-identity finding as serious, not as an identity problem", () => {
    const decision = decideReversal({
      verificationStatus: "VERIFIED",
      hasEvidence: true,
      findings: [finding("HIGH", "eightyGNumber", "80G number unreadable")],
    });
    expect(decision.action).toBe("REOPEN");
    expect(decision.severity).toBe("SERIOUS");
  });

  it("re-opens an approval that rests on no readable evidence at all", () => {
    // Uday Welfare Trust: five fields, nothing found in any document. Not a
    // contradiction — an approval with nothing behind it.
    const decision = decideReversal({ verificationStatus: "VERIFIED", hasEvidence: false, findings: [] });
    expect(decision.action).toBe("REOPEN");
    expect(decision.severity).toBe("SERIOUS");
  });

  it("does nothing for a single minor finding", () => {
    const decision = decideReversal({
      verificationStatus: "VERIFIED",
      hasEvidence: true,
      findings: [finding("MEDIUM", "a12Number")],
    });
    expect(decision.action).toBe("NONE");
  });

  it("does nothing when triage raised nothing — a missing 12A or 80G is not a defect", () => {
    // The rule lives in verification-triage, which does not raise a finding for
    // an absent 12A/80G. This policy reads findings only, so it cannot invent
    // one — that inheritance is the thing being pinned here.
    const decision = decideReversal({ verificationStatus: "VERIFIED", hasEvidence: true, findings: [] });
    expect(decision.action).toBe("NONE");
  });

  it("leaves a PENDING organisation alone — it is already in the queue", () => {
    const decision = decideReversal({
      verificationStatus: "PENDING",
      hasEvidence: false,
      findings: [finding("HIGH", "panNumber")],
    });
    expect(decision.action).toBe("NONE");
  });

  it("leaves a REJECTED organisation alone — there is no approval to un-make", () => {
    const decision = decideReversal({
      verificationStatus: "REJECTED",
      hasEvidence: true,
      findings: [finding("HIGH", "orgName")],
    });
    expect(decision.action).toBe("NONE");
  });

  it("gives a human two weeks", () => {
    expect(REVERIFICATION_WINDOW_DAYS).toBe(14);
  });
});
