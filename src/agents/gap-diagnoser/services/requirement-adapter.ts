import { normalizeFields } from '@/lib/requirements/provenance';
import { requiresFcra, requiredCertifications } from '@/lib/requirements/facts';
import type { SponsorRequirementData } from '../types/gap-types';

/**
 * SponsorRequirement.extractedFields -> the flat shape ComparisonEngine reads.
 *
 * The stored JSON is provenanced: every field is `{ value, confidence, source }`
 * (lib/requirements/provenance.ts). The engine expects plain values and calls
 * `.toLowerCase()` on them, so handing it the stored object threw
 * "requirement.sector.toLowerCase is not a function" on the FIRST dimension —
 * which the route turned into a 500 for every caller, admins included. Nothing
 * downstream ever ran.
 *
 * This is also a NAME translation, not just an unwrap. The extractor's 18
 * fields and the engine's 12 inputs were designed separately and agree on only
 * five names, so a plain `{...fields}` spread would have silently produced a
 * comparison with most dimensions missing — which reads as "nothing to report"
 * rather than as a bug.
 */

function str(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

/** Numbers survive the JSON round trip as either a number or a string. */
function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,\s]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function list(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((v) => (str(v) ? [str(v)!] : []));
  return items.length ? items : undefined;
}

export function toSponsorRequirementData(extractedFields: unknown): SponsorRequirementData {
  const f = normalizeFields(extractedFields);
  const certs = requiredCertifications(f);

  return {
    sector: str(f.sector.value),
    state: str(f.state.value),
    district: str(f.district.value),
    // The ceiling, not the floor: the engine asks whether the organisation has
    // ever run an initiative this large, and budgetMax is the size of the
    // engagement being offered. Falls back to budgetMin for a requirement that
    // names only one figure.
    budget: num(f.budgetMax.value) ?? num(f.budgetMin.value),
    durationMonths: num(f.durationMonths.value),
    beneficiaries: num(f.expectedBeneficiaries.value),
    // Primary KPIs only. The engine awards MATCH only when EVERY listed KPI is
    // found in the project text, so folding in the secondary ones would make a
    // full match practically unreachable and turn the dimension into noise.
    kpis: list(f.primaryKPIs.value),
    reportingCadence: str(f.reportingCadence.value),
    // Derived through lib/requirements/facts.ts rather than passing the raw
    // document list, because the engine compares these against verified
    // compliance flags ("12A", "80G"). A literal "Audited financials (last 3
    // years)" could never match one, and would hold the dimension at MISSING
    // for every organisation forever.
    requiredCertifications: [
      ...(certs.twelveA ? ['12A'] : []),
      ...(certs.eightyG ? ['80G'] : []),
    ],
    // Always set, never left undefined: the engine skips this dimension when
    // the key is absent, and "the donor did not ask for FCRA" is a real answer
    // worth showing rather than a silence.
    fcraRequired: requiresFcra(f),
    // Stored as one free-text field; the engine wants a list.
    specialConstraints: str(f.specialConstraints.value)
      ? [str(f.specialConstraints.value)!]
      : undefined,
    // Not among the 18 extracted fields. Left undefined so the engine skips
    // the dimension instead of reporting a gap against nothing.
    sdgGoals: undefined,
  };
}
