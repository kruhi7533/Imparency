import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { runReconciliation } from "@/lib/reconciliation";
import { runUtrSweep, type UtrSweepResult } from "@/lib/utr-sweep";

export const runtime = "nodejs";

/**
 * ADMIN-only. Run reconciliation now.
 *
 * The run itself is idempotent — it re-derives every total from the ledger and
 * bumps rather than duplicates findings — so there is no lock and no
 * in-progress guard. Two admins clicking at once produce two ReconciliationRun
 * rows and one set of exceptions, which is the correct outcome and a cheaper
 * one to reason about than a lock that can be left held.
 *
 * Logged even though it decides nothing: "when was the money last checked, and
 * by whom" is a question the audit trail has to be able to answer.
 */
export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  const result = await runReconciliation({ triggeredById: session.user.id });

  // ADM-009: match imported bank-statement lines to contract payments by UTR,
  // queue what cannot be placed, and heal milestone funding. A sweep failure
  // fails the response (never reported as clean) but does not undo the
  // ledger run above.
  let utr: UtrSweepResult | null = null;
  let utrFailed = false;
  try {
    utr = await runUtrSweep(session.user.id);
  } catch (err) {
    utrFailed = true;
    console.error("[admin/finance/reconcile] UTR sweep failed:", err);
  }

  await logAdminAction({
    adminId: session.user.id,
    action: "RECONCILIATION_RUN",
    entityType: "RECONCILIATION_RUN",
    entityId: result.runId,
    // Counts only — no ids of the entities that failed, no amounts.
    metadata: {
      projectsChecked: result.projectsChecked,
      donorsChecked: result.donorsChecked,
      donationsChecked: result.donationsChecked,
      opened: result.opened,
      recurred: result.recurred,
      autoResolved: result.autoResolved,
      failed: Boolean(result.error) || utrFailed,
      utrMatched: utr?.matched ?? 0,
      utrQueued: utr?.queued ?? 0,
      utrAutoResolved: utr?.autoResolved ?? 0,
    },
    request,
  });

  // A failed run answers 500 so the caller cannot mistake it for a clean bill
  // of health, but the run row and any findings written before the failure are
  // already persisted.
  if (utrFailed) {
    return NextResponse.json({ ...result, utr: null, error: result.error ?? "The UTR bank-statement sweep failed; the run is not clean." }, { status: 500 });
  }
  return NextResponse.json({ ...result, utr }, { status: result.error ? 500 : 200 });
}
