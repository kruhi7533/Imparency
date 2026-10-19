/**
 * Is a project ready to be matched against CSR requirements? (roadmap row 7:
 * "eligibility/capability; beneficiary/cohort minimum", acceptance "verified
 * NGO initiatives … ready for matching").
 *
 * The minimum an initiative must declare for matching to compare it on more
 * than its title: what it works on, where, WHO it serves and HOW MANY (its
 * beneficiary cohort — at least one person), and for how long. A project
 * missing these is still matchable, but the engine reports those comparisons
 * as "insufficient data" and its score covers less of what the donor asked —
 * the 70%-coverage problem from WEEK5-SPECS SPEC-8.
 *
 * Advisory, never a gate: hiding an incomplete project from matching would make
 * it look like it was never considered. Pure, no imports — safe in client
 * components.
 */

export interface ReadinessInput {
  causeCategory: string | null;
  stateName: string | null;
  expectedBeneficiaries: number | null;
  beneficiaryGroup: string | null;
  durationMonths: number | null;
  primaryKPIs?: string[] | null;
  reportingCadence?: string | null;
}

export interface ReadinessItem {
  key: keyof ReadinessInput;
  label: string;
  /** Required for "ready"; the rest only sharpen the match. */
  required: boolean;
  done: boolean;
}

/** The minimum cohort size a project must declare. */
export const MIN_COHORT = 1;

export function matchingReadiness(p: ReadinessInput): { ready: boolean; items: ReadinessItem[]; missing: string[] } {
  const filled = (v: string | null | undefined) => !!v && v.trim().length > 0;
  const items: ReadinessItem[] = [
    { key: "causeCategory", label: "Cause / sector", required: true, done: filled(p.causeCategory) },
    { key: "stateName", label: "State the project operates in", required: true, done: filled(p.stateName) },
    {
      key: "expectedBeneficiaries",
      label: `Beneficiary cohort size (at least ${MIN_COHORT})`,
      required: true,
      done: typeof p.expectedBeneficiaries === "number" && p.expectedBeneficiaries >= MIN_COHORT,
    },
    { key: "beneficiaryGroup", label: "Who the beneficiaries are", required: true, done: filled(p.beneficiaryGroup) },
    { key: "durationMonths", label: "Duration in months", required: true, done: typeof p.durationMonths === "number" && p.durationMonths > 0 },
    { key: "primaryKPIs", label: "Outcome KPIs", required: false, done: (p.primaryKPIs ?? []).some((k) => filled(k)) },
    { key: "reportingCadence", label: "Reporting cadence", required: false, done: filled(p.reportingCadence) },
  ];
  const missing = items.filter((i) => i.required && !i.done).map((i) => i.label);
  return { ready: missing.length === 0, items, missing };
}
