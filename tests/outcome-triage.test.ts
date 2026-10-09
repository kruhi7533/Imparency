import { describe, it, expect } from "vitest";
import {
  triageOutcomeClaim,
  decimalExceeds,
  evidenceUpperBound,
  verdictFor,
  type ResolvedCitation,
  type TriageInput,
} from "@/lib/outcome-triage";

/**
 * The decision table for Week 8's intelligence layer.
 *
 * This stands in for the "AI output" test CLAUDE.md requires each week: the
 * triage replaces what would otherwise be a model call, so what has to be
 * pinned is the same thing — that the verdict is schema-conformant,
 * deterministic, and does not invent findings. The false-positive boundaries
 * at the bottom matter more than the positive cases: a check that fires on
 * honest claims trains admins to dismiss the whole category, which is the
 * reasoning already written down for "a missing 12A is not a defect".
 */

const PERIOD_START = new Date("2026-09-01T00:00:00Z");
const PERIOD_END = new Date("2026-09-30T23:59:59Z");
const IN_PERIOD = new Date("2026-09-15T10:00:00Z");

function citation(over: Partial<ResolvedCitation> = {}): ResolvedCitation {
  return {
    citationId: "cit-1",
    kind: "MILESTONE_PROOF",
    evidenceRef: "proof-1",
    approved: true,
    duplicateVerdict: null,
    capturedAt: IN_PERIOD,
    ...over,
  };
}

function input(over: {
  claim?: Partial<TriageInput["claim"]>;
  metric?: Partial<TriageInput["metric"]>;
  citations?: ResolvedCitation[];
  cited?: string[];
} = {}): TriageInput {
  return {
    claim: {
      id: "claim-1",
      value: "100",
      unit: "COUNT_PEOPLE",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      ...over.claim,
    },
    metric: {
      code: "IB-TRAINED-001",
      unit: "COUNT_PEOPLE",
      status: "ACTIVE",
      requiredEvidence: ["MILESTONE_PROOF"],
      ...over.metric,
    },
    citations: over.citations ?? [citation()],
    evidenceCitedByApprovedClaims: new Set(over.cited ?? []),
  };
}

const codes = (r: ReturnType<typeof triageOutcomeClaim>) => r.findings.map((f) => f.code).sort();

describe("decimalExceeds", () => {
  it("compares without going through a float", () => {
    expect(decimalExceeds("40", 40)).toBe(false);
    expect(decimalExceeds("40.00", 40)).toBe(false);
    expect(decimalExceeds("40.01", 40)).toBe(true);
    expect(decimalExceeds("41", 40)).toBe(true);
    expect(decimalExceeds("39.99", 40)).toBe(false);
  });

  it("compares by magnitude, not string order", () => {
    // "9" > "100" lexicographically; the integer lengths must decide first.
    expect(decimalExceeds("9", 100)).toBe(false);
    expect(decimalExceeds("100", 9)).toBe(true);
    expect(decimalExceeds("0100", 100)).toBe(false);
  });

  it("survives a value large enough to lose precision as a float", () => {
    expect(decimalExceeds("9007199254740993", 9007199254740992)).toBe(true);
  });

  it("treats a negative claim as not exceeding a count bound", () => {
    expect(decimalExceeds("-5", 0)).toBe(false);
  });
});

describe("triageOutcomeClaim — blocking findings", () => {
  it("blocks a claim with no citations", () => {
    const r = triageOutcomeClaim(input({ citations: [] }));
    expect(r.verdict).toBe("BLOCKED");
    expect(codes(r)).toContain("NO_EVIDENCE_CITED");
  });

  it("blocks evidence that no human has approved", () => {
    const r = triageOutcomeClaim(input({ citations: [citation({ approved: false })] }));
    expect(r.verdict).toBe("BLOCKED");
    // Unapproved evidence also cannot satisfy the metric's required kind.
    expect(codes(r)).toEqual(["EVIDENCE_NOT_APPROVED", "REQUIRED_KIND_MISSING"]);
  });

  it("blocks when a required evidence kind is absent", () => {
    const r = triageOutcomeClaim(
      input({
        metric: { requiredEvidence: ["BENEFICIARY_FEEDBACK"] },
        citations: [citation({ kind: "MILESTONE_PROOF" })],
      })
    );
    expect(r.verdict).toBe("BLOCKED");
    expect(codes(r)).toContain("REQUIRED_KIND_MISSING");
  });

  it("blocks a unit that drifted from the metric", () => {
    const r = triageOutcomeClaim(input({ claim: { unit: "COUNT_ITEMS" } }));
    expect(r.verdict).toBe("BLOCKED");
    expect(codes(r)).toContain("UNIT_MISMATCH");
  });

  it.each(["DRAFT", "DEPRECATED"] as const)("blocks a claim against a %s metric", (status) => {
    const r = triageOutcomeClaim(input({ metric: { status } }));
    expect(r.verdict).toBe("BLOCKED");
    expect(codes(r)).toContain("METRIC_NOT_ACTIVE");
  });

  it("reports every applicable finding at once, not just the first", () => {
    const r = triageOutcomeClaim(
      input({ claim: { unit: "COUNT_ITEMS" }, metric: { status: "DRAFT" }, citations: [] })
    );
    // An empty citation list is both "nothing cited" and "the required kind is
    // absent". Both are reported: they have different fixes, and collapsing
    // them would hide the second once the first was addressed.
    expect(codes(r)).toEqual([
      "METRIC_NOT_ACTIVE",
      "NO_EVIDENCE_CITED",
      "REQUIRED_KIND_MISSING",
      "UNIT_MISMATCH",
    ]);
  });
});

describe("triageOutcomeClaim — double counting", () => {
  it("flags evidence already counted by an approved claim on the same metric", () => {
    const r = triageOutcomeClaim(input({ cited: ["proof-1"] }));
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(codes(r)).toContain("DOUBLE_COUNTED");
    expect(r.findings.find((f) => f.code === "DOUBLE_COUNTED")!.message).toContain("proof-1");
  });

  it("does NOT flag the same evidence cited on a different metric", () => {
    // One photograph can legitimately evidence both "meals provided" and
    // "sessions held" — different facts about one event. The caller scopes the
    // set to the metric, so an unrelated metric's citation never appears in it.
    const r = triageOutcomeClaim(input({ cited: [] }));
    expect(r.verdict).toBe("CLEAN");
  });

  it("names every double-counted item so both claims can be opened", () => {
    const r = triageOutcomeClaim(
      input({
        citations: [citation({ evidenceRef: "proof-1" }), citation({ citationId: "c2", evidenceRef: "proof-2" })],
        cited: ["proof-1", "proof-2"],
      })
    );
    const msg = r.findings.find((f) => f.code === "DOUBLE_COUNTED")!.message;
    expect(msg).toContain("proof-1");
    expect(msg).toContain("proof-2");
    expect(msg).toContain("2 cited item(s)");
  });
});

describe("triageOutcomeClaim — provenance, consent, arithmetic", () => {
  it.each(["CROSS_PROJECT", "REUSED_IN_PROJECT"] as const)(
    "flags a citation whose Week-7 verdict is %s",
    (verdict) => {
      const r = triageOutcomeClaim(input({ citations: [citation({ duplicateVerdict: verdict })] }));
      expect(r.verdict).toBe("NEEDS_REVIEW");
      expect(codes(r)).toContain("DUPLICATE_SOURCE_EVIDENCE");
    }
  );

  it("does NOT flag RESUBMISSION — capture then proof is the intended flow", () => {
    const r = triageOutcomeClaim(input({ citations: [citation({ duplicateVerdict: "RESUBMISSION" })] }));
    expect(r.verdict).toBe("CLEAN");
  });

  it("does NOT treat an unfingerprinted citation as tainted", () => {
    const r = triageOutcomeClaim(input({ citations: [citation({ duplicateVerdict: null })] }));
    expect(codes(r)).not.toContain("DUPLICATE_SOURCE_EVIDENCE");
  });

  it("flags beneficiary feedback with no consent, and with withdrawn consent", () => {
    const base = { kind: "BENEFICIARY_FEEDBACK" as const, evidenceRef: "fb-1" };
    const noConsent = triageOutcomeClaim(
      input({
        metric: { requiredEvidence: ["BENEFICIARY_FEEDBACK"] },
        citations: [citation({ ...base, consentToRecord: false })],
      })
    );
    expect(codes(noConsent)).toContain("CONSENT_MISSING");

    const withdrawn = triageOutcomeClaim(
      input({
        metric: { requiredEvidence: ["BENEFICIARY_FEEDBACK"] },
        citations: [citation({ ...base, consentToRecord: true, consentWithdrawn: true })],
      })
    );
    expect(codes(withdrawn)).toContain("CONSENT_MISSING");
  });

  it("bounds a people-counting claim by its consented beneficiary records", () => {
    const r = triageOutcomeClaim(
      input({
        claim: { value: "3" },
        metric: { unit: "COUNT_PEOPLE", requiredEvidence: ["BENEFICIARY_FEEDBACK"] },
        citations: [
          citation({ citationId: "c1", kind: "BENEFICIARY_FEEDBACK", evidenceRef: "fb-1", consentToRecord: true }),
          citation({ citationId: "c2", kind: "BENEFICIARY_FEEDBACK", evidenceRef: "fb-2", consentToRecord: true }),
        ],
      })
    );
    expect(codes(r)).toContain("CLAIM_EXCEEDS_EVIDENCE");
    expect(r.findings.find((f) => f.code === "CLAIM_EXCEEDS_EVIDENCE")!.message).toContain("2 consented");
  });

  it("accepts a claim exactly equal to the bound", () => {
    const r = triageOutcomeClaim(
      input({
        claim: { value: "2" },
        metric: { unit: "COUNT_PEOPLE", requiredEvidence: ["BENEFICIARY_FEEDBACK"] },
        citations: [
          citation({ citationId: "c1", kind: "BENEFICIARY_FEEDBACK", evidenceRef: "fb-1", consentToRecord: true }),
          citation({ citationId: "c2", kind: "BENEFICIARY_FEEDBACK", evidenceRef: "fb-2", consentToRecord: true }),
        ],
      })
    );
    expect(r.verdict).toBe("CLEAN");
  });

  it("invents no bound where none is defensible", () => {
    // One photo cannot tell you whether 50 or 500 meals were served. Claiming
    // a large number against a single photo must NOT fire an arithmetic
    // finding — the rule would be fabricated and would fire on honest claims.
    expect(
      evidenceUpperBound(
        { code: "IB-MEALS-001", unit: "COUNT_ITEMS", status: "ACTIVE", requiredEvidence: ["FIELD_PHOTO"] },
        [citation({ kind: "FIELD_PHOTO" })]
      )
    ).toBeNull();

    const r = triageOutcomeClaim(
      input({
        claim: { value: "500", unit: "COUNT_ITEMS" },
        metric: { unit: "COUNT_ITEMS", requiredEvidence: ["FIELD_PHOTO"] },
        citations: [citation({ kind: "FIELD_PHOTO" })],
      })
    );
    expect(codes(r)).not.toContain("CLAIM_EXCEEDS_EVIDENCE");
    expect(r.verdict).toBe("CLEAN");
  });

  it("does not count unconsented records toward the bound", () => {
    expect(
      evidenceUpperBound(
        { code: "IB-REACHED-001", unit: "COUNT_PEOPLE", status: "ACTIVE", requiredEvidence: ["BENEFICIARY_FEEDBACK"] },
        [
          citation({ kind: "BENEFICIARY_FEEDBACK", consentToRecord: true }),
          citation({ kind: "BENEFICIARY_FEEDBACK", consentToRecord: false }),
          citation({ kind: "BENEFICIARY_FEEDBACK", consentToRecord: true, consentWithdrawn: true }),
        ]
      )
    ).toBe(1);
  });

  it("flags evidence captured outside the reporting period, without blocking", () => {
    const r = triageOutcomeClaim(
      input({ citations: [citation({ capturedAt: new Date("2026-07-01T00:00:00Z") })] })
    );
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(codes(r)).toContain("PERIOD_OUTSIDE_EVIDENCE");
  });

  it("does not flag a citation with no capture date", () => {
    const r = triageOutcomeClaim(input({ citations: [citation({ capturedAt: null })] }));
    expect(codes(r)).not.toContain("PERIOD_OUTSIDE_EVIDENCE");
  });
});

describe("verdictFor", () => {
  it("BLOCK dominates HIGH", () => {
    expect(
      verdictFor([
        { code: "DOUBLE_COUNTED", severity: "HIGH", message: "" },
        { code: "NO_EVIDENCE_CITED", severity: "BLOCK", message: "" },
      ])
    ).toBe("BLOCKED");
  });

  it("MEDIUM alone still needs a human", () => {
    expect(verdictFor([{ code: "PERIOD_OUTSIDE_EVIDENCE", severity: "MEDIUM", message: "" }])).toBe(
      "NEEDS_REVIEW"
    );
  });

  it("CLEAN only when nothing fired", () => {
    expect(verdictFor([])).toBe("CLEAN");
  });

  it("CLEAN can never mean no evidence was examined", () => {
    // The structural guarantee from the blueprint: an empty citation list
    // always produces a BLOCK, so there is no path to CLEAN without citations.
    const r = triageOutcomeClaim(input({ citations: [] }));
    expect(r.verdict).not.toBe("CLEAN");
  });
});
