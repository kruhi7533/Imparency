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
