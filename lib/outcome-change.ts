import type { MetricUnit, OutcomeClaimStatus } from "@prisma/client";
import type { ClaimDisplay } from "@/lib/impact-quality";
import { fromMinorUnits, toMinorUnits } from "@/lib/impact-quality";

/**
 * Baseline → endline change for one metric on one project (ADM-014 / NGO-016 /
 * NGO-017 / DON-013).
 *
 * Pure, no I/O, no Node builtins: rendered by server pages, the CSV export and
 * client components alike.
 *
 * The rules, because this is a derived number a funder will quote:
 *  - Only figures that are APPROVED *and still backed* (claimDisplay ->
 *    "verified") take part. A submitted endline does not make an improvement.
 *  - Baseline is the verified figure with the EARLIEST reporting period,
 *    endline the one with the LATEST. Their periods must not overlap: two
 *    overlapping measurements are not a before/after.
 *  - Arithmetic is exact (minor units, never a float).
 *  - For PERCENTAGE the change is in percentage points ("+19 pp"), never a
 *    relative %, which would read 61/42 = "+45%" and mislead.
 *  - Anything short of that returns status "INSUFFICIENT_DATA" with the
 *    reason. Never 0, never a guess.
 */

export interface ChangeInputRow {
  id: string;
  metricCode: string;
  metricName: string;
  unit: MetricUnit;
  status: OutcomeClaimStatus;
  periodStart: string | Date;
  periodEnd: string | Date;
  display: ClaimDisplay;
}

export interface ChangePoint {
  claimId: string;
  value: string;
  periodStart: string;
  periodEnd: string;
}

export type OutcomeChange =
  | {
      status: "COMPUTED";
      metricCode: string;
      metricName: string;
      unit: MetricUnit;
      baseline: ChangePoint;
      endline: ChangePoint;
      /** Exact signed decimal string, e.g. "19.00" or "-3.50". */
      change: string;
      /** "pp" for PERCENTAGE, otherwise the unit's own label is used by callers. */
      changeUnit: "pp" | MetricUnit;
      /** Ready to print: "+19 pp", "-120 people". */
      label: string;
      /** Asserted figures on this metric that were NOT used (still in review, etc.). */
      excludedCount: number;
    }
  | {
      status: "INSUFFICIENT_DATA";
      metricCode: string;
      metricName: string;
      unit: MetricUnit;
      reason: string;
      verifiedCount: number;
      excludedCount: number;
    };

export const INSUFFICIENT_DATA = "INSUFFICIENT_DATA" as const;

const iso = (d: string | Date) => (typeof d === "string" ? d : d.toISOString());
const time = (d: string | Date) => new Date(d).getTime();

const UNIT_WORD: Record<string, string> = {
  COUNT_PEOPLE: "people",
  COUNT_ITEMS: "items",
  COUNT_EVENTS: "events",
  CURRENCY_INR: "INR",
  HOURS: "hours",
  KILOGRAMS: "kg",
  LITRES: "litres",
  AREA_SQM: "m²",
};

/** "19.00" -> "19", "19.50" -> "19.5". Display only. */
function trimDecimal(v: string): string {
  return v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
}

export function formatChange(change: string, unit: MetricUnit): string {
  const negative = change.startsWith("-");
  const magnitude = trimDecimal(change.replace(/^[+-]/, ""));
  const sign = magnitude === "0" ? "±" : negative ? "-" : "+";
  const suffix = unit === "PERCENTAGE" ? "pp" : UNIT_WORD[unit] ?? "";
  return `${sign}${magnitude}${suffix ? ` ${suffix}` : ""}`;
}

/** Baseline → endline for ONE metric's rows (callers group by project + metric). */
export function computeOutcomeChange(rows: ChangeInputRow[]): OutcomeChange | null {
  if (rows.length === 0) return null;
  const { metricCode, metricName, unit } = rows[0];
  const verified = rows
    .filter((r) => r.display.kind === "verified")
    .sort((a, b) => time(a.periodEnd) - time(b.periodEnd) || time(a.periodStart) - time(b.periodStart));
  const excludedCount = rows.length - verified.length;

  const insufficient = (reason: string): OutcomeChange => ({
    status: "INSUFFICIENT_DATA",
    metricCode,
    metricName,
    unit,
    reason,
    verifiedCount: verified.length,
    excludedCount,
  });

  if (verified.length === 0) {
    return insufficient(
      excludedCount > 0
        ? `No verified figure yet: ${excludedCount} reported figure(s) have not passed impact review or are no longer backed by approved evidence.`
        : "No figures reported for this metric.",
    );
  }
  if (verified.length === 1) {
    return insufficient(
      excludedCount > 0
        ? `Only one verified figure; ${excludedCount} other reported figure(s) have not passed impact review, so there is no verified baseline and endline to compare.`
        : "Only one verified figure, so there is no baseline and endline to compare.",
    );
  }

  const baseline = verified[0];
  const endline = verified[verified.length - 1];
  if (time(endline.periodStart) < time(baseline.periodEnd)) {
    return insufficient("The earliest and latest verified figures cover overlapping periods, so they are not a before/after measurement.");
  }

  const change = fromMinorUnits(
    toMinorUnits((endline.display as { value: string }).value) - toMinorUnits((baseline.display as { value: string }).value),
  );
  return {
    status: "COMPUTED",
    metricCode,
    metricName,
    unit,
    baseline: {
      claimId: baseline.id,
      value: (baseline.display as { value: string }).value,
      periodStart: iso(baseline.periodStart),
      periodEnd: iso(baseline.periodEnd),
    },
    endline: {
      claimId: endline.id,
      value: (endline.display as { value: string }).value,
      periodStart: iso(endline.periodStart),
      periodEnd: iso(endline.periodEnd),
    },
    change,
    changeUnit: unit === "PERCENTAGE" ? "pp" : unit,
    label: formatChange(change, unit),
    excludedCount,
  };
}

/** One change per metric over a project's rows, sorted by metric name. */
export function changesByMetric(rows: ChangeInputRow[]): OutcomeChange[] {
  const by = new Map<string, ChangeInputRow[]>();
  for (const r of rows) by.set(r.metricCode, [...(by.get(r.metricCode) ?? []), r]);
  return Array.from(by.values())
    .map((group) => computeOutcomeChange(group))
    .filter((c): c is OutcomeChange => c !== null)
    .sort((a, b) => a.metricName.localeCompare(b.metricName));
}
