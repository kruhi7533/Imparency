import { describe, it, expect, vi } from "vitest";

// resolveField and deriveComplianceEvidence are pure, but their modules import
// the Prisma singleton at load time.
vi.mock("@/lib/prisma", () => ({ default: {} }));

import { resolveField, CONFIDENCE_THRESHOLD } from "@/lib/extraction-runner";
import { deriveComplianceEvidence } from "@/lib/compliance-evidence";
import type { ExtractedFieldResult } from "@/lib/gemini/extract-ngo-fields";

function agentResult(over: Partial<ExtractedFieldResult> = {}): ExtractedFieldResult {
  return {
    fieldKey: "panNumber",
    value: "ABCDE1234F",
    confidence: 0.95,
    sourceDocumentIndex: 0,
    note: null,
    ...over,
  };
}

describe("resolveField — confidence threshold", () => {
  it("accepts a high-confidence value that matches the form", () => {
    const r = resolveField(agentResult(), "ABCDE1234F");
    expect(r.status).toBe("EXTRACTED");
    expect(r.matchesSubmitted).toBe(true);
    expect(r.flags).toHaveLength(0);
  });

  it("holds a value read below the threshold", () => {
    const r = resolveField(agentResult({ confidence: 0.6 }), "ABCDE1234F");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.flags.some((f) => f.issue.includes("below the"))).toBe(true);
  });

  it("treats the threshold as inclusive", () => {
    const r = resolveField(agentResult({ confidence: CONFIDENCE_THRESHOLD }), "ABCDE1234F");
    expect(r.status).toBe("EXTRACTED");
  });
});

describe("resolveField — never invent a value", () => {
  it("holds a null value at zero confidence regardless of what the agent claimed", () => {
    const r = resolveField(agentResult({ value: null, confidence: 0.99 }), "ABCDE1234F");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.extractedValue).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.matchesSubmitted).toBeNull();
  });

  it("does not fall back to the submitted value when nothing was found", () => {
    const r = resolveField(agentResult({ value: null }), "ABCDE1234F");
    expect(r.extractedValue).not.toBe("ABCDE1234F");
    expect(r.extractedValue).toBeNull();
  });
});

describe("resolveField — deterministic format checks override model confidence", () => {
  it("holds a malformed PAN even at 99% confidence", () => {
    const r = resolveField(agentResult({ value: "AB12", confidence: 0.99 }), "AB12");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.confidence).toBeLessThanOrEqual(0.3);
    expect(r.flags.some((f) => f.severity === "HIGH" && f.issue.includes("PAN format"))).toBe(true);
  });

  it("holds a malformed registration number even at 99% confidence", () => {
    const r = resolveField(
      agentResult({ fieldKey: "registrationNumber", value: "x", confidence: 0.99 }),
      "x"
    );
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });

  it("cannot be pushed back up to EXTRACTED by a passing cross-check", () => {
    // Value matches the form exactly, but is not a valid PAN — still held.
    const r = resolveField(agentResult({ value: "NOTAPAN", confidence: 1 }), "NOTAPAN");
    expect(r.matchesSubmitted).toBe(true);
    expect(r.status).toBe("NEEDS_REVIEW");
  });
});

describe("resolveField — cross-check against the registration form", () => {
  it("flags a document/form mismatch as HIGH and holds the field", () => {
    const r = resolveField(agentResult(), "ZZZZZ9999Z");
    expect(r.matchesSubmitted).toBe(false);
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.flags.some((f) => f.severity === "HIGH")).toBe(true);
  });

  it("ignores casing and punctuation differences", () => {
    const r = resolveField(agentResult({ value: "abcde 1234 f" }), "ABCDE1234F");
    expect(r.matchesSubmitted).toBe(true);
    expect(r.status).toBe("EXTRACTED");
  });

  it("tolerates an org-name suffix on one side only", () => {
    const r = resolveField(
      agentResult({ fieldKey: "orgName", value: "Sahyog Foundation (Regd.)" }),
      "Sahyog Foundation"
    );
    expect(r.matchesSubmitted).toBe(true);
  });

  it("reports null match when there is no submitted value to compare", () => {
    const r = resolveField(
      agentResult({ fieldKey: "eightyGNumber", value: "AAATS1234FF20214" }),
      null
    );
    expect(r.matchesSubmitted).toBeNull();
    expect(r.status).toBe("EXTRACTED");
  });
});

describe("deriveComplianceEvidence", () => {
  it("earns a flag only from a VALIDATED field", () => {
    const e = deriveComplianceEvidence([
      { fieldKey: "panNumber", status: "VALIDATED" },
      { fieldKey: "registrationNumber", status: "EXTRACTED" },
      { fieldKey: "eightyGNumber", status: "NEEDS_REVIEW" },
      { fieldKey: "a12Number", status: "REJECTED" },
    ]);

    expect(e.earned.panVerified).toBe(true);
    // Read clearly but never confirmed by a human — not earned.
    expect(e.earned.registrationVerified).toBe(false);
    expect(e.earned.eightyGVerified).toBe(false);
    expect(e.earned.a12Verified).toBe(false);
    expect(e.outstanding).toEqual(["eightyGNumber"]);
  });

  it("earns nothing when extraction never ran", () => {
    const e = deriveComplianceEvidence([]);
    expect(Object.values(e.earned).every((v) => v === false)).toBe(true);
    expect(e.noExtraction).toBe(true);
    expect(e.outstanding).toEqual([]);
  });

  it("earns every flag when all four fields are validated", () => {
    const e = deriveComplianceEvidence([
      { fieldKey: "panNumber", status: "VALIDATED" },
      { fieldKey: "registrationNumber", status: "VALIDATED" },
      { fieldKey: "eightyGNumber", status: "VALIDATED" },
      { fieldKey: "a12Number", status: "VALIDATED" },
    ]);
    expect(Object.values(e.earned).every((v) => v === true)).toBe(true);
    expect(e.outstanding).toEqual([]);
  });
});
