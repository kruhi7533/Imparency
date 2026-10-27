import { z } from "zod";
import type { ExtractedRequirementJSON } from "@/src/agents/requirements-agent/validators/schema";

/**
 * The wire schema Claude fills for CSR requirement extraction (AI-001).
 *
 * RequirementSchema makes every value nullable — 19 union-typed parameters —
 * and Anthropic structured outputs refuse a schema with more than 16 unions
 * (400 invalid_request_error), so every Claude extraction failed and silently
 * fell back to the rule-based reader. Here "not stated" is encoded WITHOUT a
 * union: an empty string / empty list (numbers are written as digit strings,
 * FCRA as an enum). fromClaudeRequirement() maps it back to the nullable
 * RequirementSchema shape, so everything downstream is unchanged.
 */
const text = z.object({ value: z.string(), confidence: z.number() });
const list = z.object({ value: z.array(z.string()), confidence: z.number() });

export const ClaudeRequirementSchema = z.object({
  sector: text,
  state: text,
  district: text,
  budgetMin: text,
  budgetMax: text,
  currency: text,
  durationMonths: text,
  expectedBeneficiaries: text,
  primaryKPIs: list,
  secondaryKPIs: list,
  reportingCadence: text,
  timeline: text,
  requiredDocuments: list,
  contactPerson: text,
  contactEmail: text,
  contactPhone: text,
  specialConstraints: text,
  summary: text,
  fcraRequired: z.object({ value: z.enum(["yes", "no", "not_stated"]), confidence: z.number() }),
});
export type ClaudeRequirement = z.infer<typeof ClaudeRequirementSchema>;

export const CLAUDE_REQUIREMENT_FORMAT = [
  "Output format for this response: every field is {value, confidence}.",
  'When the document does not state a field, return an empty string "" (or an empty list) with confidence 0 — never guess.',
  "budgetMin, budgetMax, durationMonths and expectedBeneficiaries are plain digits in rupees / months / people (e.g. \"3000000\"), no separators or units.",
  'fcraRequired is "yes", "no" or "not_stated".',
].join("\n");

const clamp = (c: number) => (Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0);
const field = <T>(value: T | null, confidence: number) => ({ value, confidence: value === null ? 0 : clamp(confidence) });

function str(f: { value: string; confidence: number }) {
  const v = f.value.trim();
  return field(v === "" ? null : v, f.confidence);
}
function num(f: { value: string; confidence: number }) {
  const digits = f.value.replace(/[,\s₹]/g, "").replace(/^rs\.?/i, "");
  const n = digits === "" ? NaN : Number(digits);
  return field(Number.isFinite(n) ? n : null, f.confidence);
}
function arr(f: { value: string[]; confidence: number }) {
  const v = f.value.map((s) => s.trim()).filter(Boolean);
  return field(v.length ? v : null, f.confidence);
}

export function fromClaudeRequirement(r: ClaudeRequirement): ExtractedRequirementJSON {
  return {
    sector: str(r.sector),
    state: str(r.state),
    district: str(r.district),
    budgetMin: num(r.budgetMin),
    budgetMax: num(r.budgetMax),
    currency: str(r.currency),
    durationMonths: num(r.durationMonths),
    expectedBeneficiaries: num(r.expectedBeneficiaries),
    primaryKPIs: arr(r.primaryKPIs),
    secondaryKPIs: arr(r.secondaryKPIs),
    reportingCadence: str(r.reportingCadence),
    timeline: str(r.timeline),
    requiredDocuments: arr(r.requiredDocuments),
    contactPerson: str(r.contactPerson),
    contactEmail: str(r.contactEmail),
    contactPhone: str(r.contactPhone),
    specialConstraints: str(r.specialConstraints),
    summary: str(r.summary),
    fcraRequired: field(r.fcraRequired.value === "not_stated" ? null : r.fcraRequired.value === "yes", r.fcraRequired.confidence),
  };
}
