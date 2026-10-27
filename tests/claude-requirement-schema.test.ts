import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ClaudeRequirementSchema, fromClaudeRequirement } from "@/lib/requirements/claude-requirement-schema";
import { RequirementSchema } from "@/src/agents/requirements-agent/validators/schema";

// AI-001: the Claude wire schema must stay under the structured-output union
// limit (16) — the nullable RequirementSchema had 19 and every call was a 400.
function countUnions(node: any): number {
  if (!node || typeof node !== "object") return 0;
  let n = Array.isArray(node.type) || Array.isArray(node.anyOf) || Array.isArray(node.oneOf) ? 1 : 0;
  for (const v of Object.values(node)) n += countUnions(v);
  return n;
}

const blank = (v: any = "") => ({ value: v, confidence: 0 });
const base = {
  sector: { value: "Education", confidence: 0.9 },
  state: { value: "Karnataka", confidence: 0.95 },
  district: blank(),
  budgetMin: blank(),
  budgetMax: { value: "30,00,000", confidence: 0.8 },
  currency: { value: "INR", confidence: 0.9 },
  durationMonths: { value: "12", confidence: 0.9 },
  expectedBeneficiaries: blank(),
  primaryKPIs: { value: ["Reading level", " "], confidence: 0.7 },
  secondaryKPIs: blank([]),
  reportingCadence: { value: "Quarterly", confidence: 0.9 },
  timeline: blank(),
  requiredDocuments: blank([]),
  contactPerson: blank(),
  contactEmail: blank(),
  contactPhone: blank(),
  specialConstraints: blank(),
  summary: { value: "Digital literacy", confidence: 0.8 },
  fcraRequired: { value: "not_stated" as const, confidence: 0.4 },
};

describe("ClaudeRequirementSchema", () => {
  it("has no union-typed parameters", () => {
    expect(countUnions(z.toJSONSchema(ClaudeRequirementSchema))).toBe(0);
    // Structural check too: no nullable/optional/union nodes.
    const src = JSON.stringify(ClaudeRequirementSchema.shape, (_k, v) => (v && v._def ? v._def.typeName : v));
    expect(src).not.toMatch(/ZodNullable|ZodOptional|ZodUnion/);
  });

  it("maps empty values to null with zero confidence, parses numbers, and validates as RequirementSchema", () => {
    const out = RequirementSchema.parse(fromClaudeRequirement(ClaudeRequirementSchema.parse(base)));
    expect(out.budgetMax).toEqual({ value: 3000000, confidence: 0.8 });
    expect(out.budgetMin).toEqual({ value: null, confidence: 0 });
    expect(out.primaryKPIs.value).toEqual(["Reading level"]);
    expect(out.secondaryKPIs.value).toBeNull();
    expect(out.fcraRequired).toEqual({ value: null, confidence: 0 });
  });

  it("reads FCRA yes/no and never invents a number from text", () => {
    const out = fromClaudeRequirement({ ...base, fcraRequired: { value: "yes", confidence: 1.4 }, durationMonths: { value: "about a year", confidence: 0.5 } });
    expect(out.fcraRequired).toEqual({ value: true, confidence: 1 });
    expect(out.durationMonths).toEqual({ value: null, confidence: 0 });
  });
});
