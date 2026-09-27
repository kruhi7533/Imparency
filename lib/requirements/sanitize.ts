import type { RequirementFields } from "./provenance";
import { requiresFcra, requiredCertifications } from "./facts";

/**
 * The NGO-facing view of a CSR requirement. Built by allowlist: only the
 * fields below ever leave the server for an NGO. Deliberately excluded:
 * the original document and raw text, the AI summary (it names the donor and
 * often their strategy), special constraints (free text, frequently
 * confidential), all contact details, confidence/provenance, admin notes,
 * gap-analysis internals and audit data.
 */
export interface OpportunityBrief {
  id: string;
  title: string;
  sector: string | null;
  state: string | null;
  district: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
  durationMonths: number | null;
  expectedBeneficiaries: number | null;
  keyOutcomes: string[];
  secondaryOutcomes: string[];
  reportingCadence: string | null;
  timeline: string | null;
  fcraRequired: boolean;
  requires80G: boolean;
  requires12A: boolean;
  requiredDocuments: string[];
  publishedAt: string | null;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

/** Defense in depth: strip anything that looks like contact details from free text. */
function scrub(text: string): string {
  return text.replace(EMAIL, "[redacted]").replace(PHONE, "[redacted]").trim();
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? scrub(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map(scrub) : [];

export function buildOpportunityBrief(
  requirementId: string,
  fields: RequirementFields,
  publishedAt: Date | null = null
): OpportunityBrief {
  const sector = str(fields.sector.value);
  const state = str(fields.state.value);
  const certs = requiredCertifications(fields);

  return {
    id: requirementId,
    title: [sector ? `${sector} CSR opportunity` : "CSR opportunity", state ? `in ${state}` : null]
      .filter(Boolean)
      .join(" "),
    sector,
    state,
    district: str(fields.district.value),
    budgetMin: num(fields.budgetMin.value),
    budgetMax: num(fields.budgetMax.value),
    currency: str(fields.currency.value),
    durationMonths: num(fields.durationMonths.value),
    expectedBeneficiaries: num(fields.expectedBeneficiaries.value),
    keyOutcomes: list(fields.primaryKPIs.value),
    secondaryOutcomes: list(fields.secondaryKPIs.value),
    reportingCadence: str(fields.reportingCadence.value),
    timeline: str(fields.timeline.value),
    fcraRequired: requiresFcra(fields),
    requires80G: certs.eightyG,
    requires12A: certs.twelveA,
    requiredDocuments: list(fields.requiredDocuments.value),
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
  };
}
