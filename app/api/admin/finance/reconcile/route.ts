import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { runReconciliation } from "@/lib/reconciliation";

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
      failed: Boolean(result.error),
    },
    request,
  });

  // A failed run answers 500 so the caller cannot mistake it for a clean bill
  // of health, but the run row and any findings written before the failure are
  // already persisted.
  return NextResponse.json(result, { status: result.error ? 500 : 200 });
}
