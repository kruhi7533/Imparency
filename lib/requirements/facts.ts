import type { RequirementFields } from "./provenance";

/**
 * Deterministic facts derived from validated requirement fields. These are
 * only ever read from explicit text in the requirement — never inferred as
 * "likely" — and are shared by the matching engine and the NGO brief so both
 * agree on what the donor requires.
 */

function textOf(fields: RequirementFields, keys: Array<keyof RequirementFields>): string {
  return keys
    .map((k) => {
      const v = fields[k]?.value;
      return Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : "";
    })
    .join(" ");
}

const FCRA_PATTERN = /\bFCRA\b|foreign\s+contribution/i;

/** True only when the requirement explicitly mentions FCRA / foreign contribution. */
export function requiresFcra(fields: RequirementFields): boolean {
  return FCRA_PATTERN.test(textOf(fields, ["specialConstraints", "requiredDocuments", "summary"]));
}

/** Registrations the donor explicitly lists as required documents/constraints. */
export function requiredCertifications(fields: RequirementFields): { eightyG: boolean; twelveA: boolean } {
  const text = textOf(fields, ["requiredDocuments", "specialConstraints"]);
  return {
    eightyG: /\b80\s*-?\s*G\b/i.test(text),
    twelveA: /\b12\s*-?\s*A{1,2}\b/i.test(text),
  };
}
