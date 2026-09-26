import type { RiskBand } from "@prisma/client";

/**
 * Shared vocabulary for the two risk engines.
 *
 * Both engines are DETERMINISTIC — no model call, ever. They aggregate signals
 * that other parts of the platform already produce (alerts, compliance flags,
 * extraction status, PAN verification) into one number a human can act on.
 * They do not invent new detectors: a threshold lives in exactly one place, in
 * the check that raises the alert, and the engine reads the alert. Duplicating
 * a threshold here would let the two drift and nobody would notice which was
 * right.
 */

export interface RiskSignal {
  /** Stable machine key — safe to switch on, safe to store. */
  code: string;
  /** One short line an admin reads without further explanation. */
  label: string;
  /** Points this signal contributed. Always positive; nothing reduces risk. */
  points: number;
  /** Optional specifics: counts, names, dates. */
  detail?: string;
}

export interface RiskScoreResult {
  /** 0..100, higher is worse. */
  score: number;
  band: RiskBand;
  signals: RiskSignal[];
  /**
   * Critical inputs that could not be evaluated. NOT a count of every missing
   * field — only evidence whose absence means we genuinely cannot judge the
   * entity, which is what forces the UNKNOWN band.
   */
  unknownInputs: number;
}

export const BAND_THRESHOLD = {
  medium: 25,
  high: 55,
} as const;

/**
 * Turn a score into a band.
 *
 * The rule that matters: a missing critical input produces UNKNOWN, never LOW.
 * "We have no evidence" and "we looked and it was fine" must never render the
 * same way — the same invariant that governs unanalysed NGOs in the extraction
 * pipeline, and the same one the fraud investigator's incomplete runs now obey.
 *
 * A score that has already cleared the HIGH threshold stays HIGH regardless of
 * what else is unknown: we may not know everything, but we know enough.
 */
export function bandFor(score: number, unknownInputs: number): RiskBand {
  if (score >= BAND_THRESHOLD.high) return "HIGH";
  if (unknownInputs > 0) return "UNKNOWN";
  if (score >= BAND_THRESHOLD.medium) return "MEDIUM";
  return "LOW";
}

/** Scores are points out of 100 and several signals can stack past it. */
export function clampScore(points: number): number {
  return Math.max(0, Math.min(100, Math.round(points)));
}

export function finalise(signals: RiskSignal[], unknownInputs: number): RiskScoreResult {
  const score = clampScore(signals.reduce((sum, s) => sum + s.points, 0));
  return { score, band: bandFor(score, unknownInputs), signals, unknownInputs };
}
