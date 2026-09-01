import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { BACKGROUND_WALL_CLOCK_MS, INVESTIGATOR_ENABLED } from "./config";

/**
 * Decides whether a HIGH-severity NGO alert deserves a full investigation, and
 * fires it in the background if so.
 *
 * Wired into ONE place — createFraudAlert() in lib/fraud-alerts.ts — rather than
 * every call site that raises an alert (registration, milestone scoring, PAN
 * duplicate checks, verification triage). That is the fix for the mistake made
 * with the deleted caseworker: an agent that only runs when someone remembers
 * to call it from a new call site never actually runs. This one runs wherever
 * createFraudAlert already runs, today and for every future call site too.
 *
 * Deliberately narrow: only entityType NGO, only severity HIGH. Medium and low
 * alerts are exactly the pattern-matching noise the investigator's own system
 * prompt (rule 2) warns against chasing — they stay in the ordinary admin queue.
 */
export async function maybeInvestigate(
  entityType: string,
  entityId: string,
  severity: string,
  alertId: string
): Promise<void> {
  if (!INVESTIGATOR_ENABLED) return;
  if (entityType !== "NGO" || severity !== "HIGH") return;

  try {
    // entityType "NGO" does not guarantee entityId IS an NGO id — several
    // alerts in lib/risk-agent.ts store a milestone or project id under that
    // type. Resolve before touching a column with an NGO foreign key.
    const { resolveNgoId } = await import("./resolve-ngo");
    const ngoId = await resolveNgoId(entityId);
    if (!ngoId) return;

    // Debounce: several HIGH alerts can land within seconds of each other for
    // the same NGO (e.g. verification triage raising both a name-mismatch and
    // a duplicate-identity alert). One investigation covers all of them.
    const recent = await prisma.fraudInvestigation.findFirst({
      where: { ngoId, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
      select: { id: true },
    });
    if (recent) return;

    const { investigate } = await import("./run");
    // Fire-and-forget: createFraudAlert() already returns before this resolves
    // for every existing caller. A run takes up to WALL_CLOCK_MS; nothing here
    // should block the action that raised the alert.
    // Nobody is waiting on this one, so give it a wall clock that a free-tier
    // TPM throttle can actually finish inside — the interactive default exists
    // for the admin route, where a request is held open.
    investigate(ngoId, alertId, `alert:${alertId}`, { wallClockMs: BACKGROUND_WALL_CLOCK_MS }).catch((err) => {
      captureError(err, {
        scope: "lib/fraud-investigator/trigger",
        operation: "auto_investigate",
        entityType: "NGO",
        entityId: ngoId,
      });
    });
  } catch (err) {
    captureError(err, {
      scope: "lib/fraud-investigator/trigger",
      operation: "maybe_investigate",
      entityType: "NGO",
      entityId,
    });
  }
}
