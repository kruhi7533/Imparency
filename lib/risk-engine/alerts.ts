import type { RiskSignal } from "./types";

/**
 * Unresolved fraud alerts, turned into points.
 *
 * Shared by both engines because an open HIGH alert means the same thing
 * whoever it is about. Per-severity caps exist so that volume alone cannot
 * dominate a score: ten open LOW alerts is a housekeeping problem, not a
 * fraud signal, and a scorer that ranks it above one open HIGH is worse than
 * no scorer at all.
 */

export const ALERT_POINTS = {
  HIGH: { each: 20, cap: 40 },
  MEDIUM: { each: 8, cap: 24 },
  LOW: { each: 2, cap: 6 },
} as const;

export interface AlertLike {
  severity: string;
  type: string;
}

export function scoreOpenAlerts(alerts: AlertLike[]): RiskSignal[] {
  const signals: RiskSignal[] = [];

  for (const severity of ["HIGH", "MEDIUM", "LOW"] as const) {
    const matching = alerts.filter((a) => a.severity === severity);
    if (matching.length === 0) continue;

    const { each, cap } = ALERT_POINTS[severity];
    const points = Math.min(matching.length * each, cap);
    const types = Array.from(new Set(matching.map((a) => a.type)));

    signals.push({
      code: `OPEN_${severity}_ALERTS`,
      label:
        matching.length === 1
          ? `1 unresolved ${severity} alert`
          : `${matching.length} unresolved ${severity} alerts`,
      points,
      detail: types.slice(0, 4).join(", "),
    });
  }

  return signals;
}
