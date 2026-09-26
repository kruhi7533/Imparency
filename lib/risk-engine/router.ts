import type { RiskAction, RiskEntityType } from "@prisma/client";
import type { RiskScoreResult } from "./types";

/**
 * What to do about a score.
 *
 * This is the box between "LOW/MED → Monitor" and "HIGH → CASE" in the fraud
 * system design, with one lane the data made necessary: an entity we cannot
 * assess is not the same problem as one that looks bad, and it needs a
 * different — much cheaper — response.
 *
 * Pure and deterministic. Routing decides where expensive attention goes, and
 * that decision has to be reviewable without re-running anything.
 */

export interface Route {
  action: RiskAction;
  reason: string;
}

export function routeFor(entityType: RiskEntityType, result: RiskScoreResult): Route {
  // No evidence: read the documents before spending an investigation on it.
  // The investigator has no way to make progress on an NGO whose documents were
  // never analysed — it would call get_document_evidence, receive
  // `analysed: false`, and correctly file nothing, at full token cost. Six
  // minutes to be told what the score already said.
  if (result.band === "UNKNOWN" && entityType === "NGO") {
    return {
      action: "EXTRACT",
      reason:
        "Banded UNKNOWN: registration documents have never been analysed. Extraction first — an investigation has nothing to read.",
    };
  }

  if (result.band === "HIGH") {
    // The investigator is NGO-only (see lib/fraud-investigator/trigger.ts).
    // A high-scoring donor is a real finding with nowhere automated to send it,
    // so it is recorded as MONITOR rather than silently dropped — the gap is
    // visible in the audit trail instead of invisible in the code.
    if (entityType !== "NGO") {
      return {
        action: "MONITOR",
        reason: `Scored ${result.score} (HIGH), but the fraud investigator only handles NGOs. Needs a human.`,
      };
    }
    const top = result.signals[0];
    return {
      action: "INVESTIGATE",
      reason: `Scored ${result.score} (HIGH)${top ? ` — led by: ${top.label}` : ""}.`,
    };
  }

  return {
    action: "MONITOR",
    reason: `Scored ${result.score} (${result.band}). Below the threshold for spending an investigation.`,
  };
}
