import { describe, it, expect } from "vitest";
import {
  applyEdits,
  normalizeFields,
  verifyAll,
  withAiProvenance,
  lowConfidenceKeys,
} from "@/lib/requirements/provenance";
import { RequirementWorkflowError } from "@/lib/requirements/errors";

const ai = withAiProvenance({
  sector: { value: "Education", confidence: 0.95 },
  budgetMin: { value: 1000000, confidence: 0.62 },
  budgetMax: { value: 2000000, confidence: 0.72 },
  primaryKPIs: { value: ["Learning outcomes"], confidence: 0.9 },
} as any);

describe("field provenance", () => {
  it("tags extraction output as AI_EXTRACTED and fills missing fields with null (never invented)", () => {
    expect(ai.sector).toEqual({ value: "Education", confidence: 0.95, source: "AI_EXTRACTED" });
    expect(ai.district).toEqual({ value: null, confidence: 0, source: "AI_EXTRACTED" });
  });

  it("marks only changed fields as DONOR_CORRECTED and keeps the AI confidence", () => {
    const { fields, changedKeys } = applyEdits(ai, { budgetMax: 7500000, sector: "Education" }, "DONOR");
    expect(changedKeys).toEqual(["budgetMax"]);
    expect(fields.budgetMax).toEqual({ value: 7500000, confidence: 1, source: "DONOR_CORRECTED", aiConfidence: 0.72 });
    // Untouched fields are NOT blanket-upgraded to 100%.
    expect(fields.sector).toEqual(ai.sector);
    expect(fields.budgetMin).toEqual(ai.budgetMin);
  });

  it("marks admin changes as ADMIN_VERIFIED", () => {
    const { fields } = applyEdits(ai, { district: "Kamrup" }, "ADMIN");
    expect(fields.district.source).toBe("ADMIN_VERIFIED");
    expect(fields.district.confidence).toBe(1);
  });

  it("admin approval verifies every field without inventing values", () => {
    const donorEdited = applyEdits(ai, { budgetMax: 7500000 }, "DONOR").fields;
    const verified = verifyAll(donorEdited);
    expect(verified.budgetMax).toMatchObject({ value: 7500000, confidence: 1, source: "ADMIN_VERIFIED", aiConfidence: 0.72 });
    expect(verified.sector).toMatchObject({ value: "Education", confidence: 1, source: "ADMIN_VERIFIED", aiConfidence: 0.95 });
    // A missing value stays missing (and uncertain) — approval does not make it "known".
    expect(verified.district).toMatchObject({ value: null, confidence: 0, source: "ADMIN_VERIFIED" });
  });

  it("normalizes values and rejects bad types", () => {
    const { fields } = applyEdits(ai, { state: "  Assam ", secondaryKPIs: [" a ", "", "b"], timeline: "" }, "DONOR");
    expect(fields.state.value).toBe("Assam");
    expect(fields.secondaryKPIs.value).toEqual(["a", "b"]);
    expect(fields.timeline.value).toBeNull();
    expect(() => applyEdits(ai, { budgetMin: -5 }, "DONOR")).toThrow(RequirementWorkflowError);
    expect(() => applyEdits(ai, { notAField: "x" }, "DONOR")).toThrow(RequirementWorkflowError);
    expect(() => applyEdits(ai, { primaryKPIs: "not a list" }, "DONOR")).toThrow(RequirementWorkflowError);
  });

  it("treats legacy rows without a source as AI_EXTRACTED", () => {
    const legacy = normalizeFields({ sector: { value: "Health", confidence: 0.8 } });
    expect(legacy.sector.source).toBe("AI_EXTRACTED");
  });

  it("flags low-confidence AI values (< 75%) for verification", () => {
    expect(lowConfidenceKeys(ai)).toEqual(["budgetMin", "budgetMax"]);
  });
});
