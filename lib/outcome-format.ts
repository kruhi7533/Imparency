/**
 * How an outcome figure or a rupee amount is written for a donor. Pure, no
 * imports, so server pages and client components render the same text.
 *
 * Display only: amounts arrive as exact decimal strings and are converted to a
 * Number solely to insert Indian digit grouping, never for arithmetic.
 */

export const OUTCOME_UNIT_LABEL: Record<string, string> = {
  COUNT_PEOPLE: "people",
  COUNT_ITEMS: "items",
  COUNT_EVENTS: "events",
  PERCENTAGE: "%",
  HOURS: "hours",
  KILOGRAMS: "kg",
  LITRES: "litres",
  AREA_SQM: "m²",
};

export const inr = (v: { toString(): string } | number) => `₹${Number(v.toString()).toLocaleString("en-IN")}`;

export const formatOutcome = (value: string, unit: string) =>
  unit === "CURRENCY_INR" ? inr(value) : `${Number(value).toLocaleString("en-IN")} ${OUTCOME_UNIT_LABEL[unit] ?? ""}`.trim();

/**
 * The headline figure for a per-metric roll-up. A summable metric shows its
 * verified total; a non-summable one (percentages) shows its LATEST verified
 * figure, labelled as such — never a sum. Null when nothing is verified, so
 * the caller renders "Unverified", never 0.
 */
export function rollupFigure(m: {
  verifiedCount: number;
  verifiedTotal: string | null;
  latestVerified: { value: string } | null;
  unit: string;
}): string | null {
  if (m.verifiedCount === 0) return null;
  if (m.verifiedTotal !== null) return formatOutcome(m.verifiedTotal, m.unit);
  return m.latestVerified ? `${formatOutcome(m.latestVerified.value, m.unit)} (latest)` : null;
}
