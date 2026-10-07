import { NextResponse } from "next/server";
import { Role, GrievanceSeverity } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import {
  GRIEVANCE_TRANSITIONS,
  isGrievanceAction,
  requiresNote,
  requiresSeverity,
  explainRefusal,
  GRIEVANCE_ACTIONS,
} from "@/lib/grievance-workflow";

export const runtime = "nodejs";

const NOTE_MAX = 2000;

/**
 * ADMIN-only. Move one grievance along: TRIAGE, START_INVESTIGATION, RESOLVE,
 * DISMISS.
 *
 * Compare-and-swap on the status the action is legal from, so two admins
 * triaging at once means the second gets a 409 rather than silently
 * overwriting the first one's severity call. Same shape as the proposal
 * lifecycle and the finance-exception close.
 *
 * The audit log here carries ids, the action, the status change and the
 * category — NEVER the complaint body and NEVER the resolution note, which is
 * the one place this route deliberately departs from the finance-exception
 * precedent. See the comment beside GRIEVANCE_TRIAGED in lib/admin-log.ts.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  let body: { action?: unknown; severity?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isGrievanceAction(body.action)) {
    return NextResponse.json(
      { error: `Unknown action. Expected one of: ${GRIEVANCE_ACTIONS.join(", ")}.` },
      { status: 400 }
    );
  }
  const action = body.action;
  const transition = GRIEVANCE_TRANSITIONS[action];

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (requiresNote(action) && !note) {
    return NextResponse.json(
      {
        error:
          action === "DISMISS"
            ? "Say why this complaint is being dismissed. The reporter is entitled to a reason."
            : "Say what was done about this complaint.",
      },
      { status: 400 }
    );
  }
  if (note.length > NOTE_MAX) {
    return NextResponse.json({ error: `Keep the note under ${NOTE_MAX} characters.` }, { status: 400 });
  }

  let severity: GrievanceSeverity | null = null;
  if (requiresSeverity(action)) {
    // hasOwnProperty, not `in` — see the same fix in lib/grievance-workflow.ts.
    if (
      typeof body.severity !== "string" ||
      !Object.prototype.hasOwnProperty.call(GrievanceSeverity, body.severity)
    ) {
      return NextResponse.json(
        { error: "Triage has to set a severity — that judgement is the point of triaging." },
        { status: 400 }
      );
    }
    severity = body.severity as GrievanceSeverity;
  }

  const existing = await prisma.grievance.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, category: true, ngoId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Grievance not found" }, { status: 404 });
  }

  if (existing.status !== transition.from) {
    return NextResponse.json({ error: explainRefusal(action, existing.status) }, { status: 409 });
  }

  const now = new Date();
  const { count } = await prisma.grievance.updateMany({
    where: { id: params.id, status: transition.from },
    data: {
      status: transition.to,
      ...(severity ? { severity, triagedById: session.user.id, triagedAt: now } : {}),
      ...(requiresNote(action)
        ? { resolutionNote: note, resolvedById: session.user.id, resolvedAt: now }
        : {}),
    },
  });

  // Lost the race: someone else moved it between the read above and this
  // write. Their decision stands.
  if (count === 0) {
    return NextResponse.json(
      { error: "Another admin just acted on this grievance. Reload to see where it stands." },
      { status: 409 }
    );
  }

  await logAdminAction({
    adminId: session.user.id,
    action: transition.logged,
    entityType: "GRIEVANCE",
    entityId: params.id,
    oldValue: { status: transition.from },
    newValue: { status: transition.to, ...(severity ? { severity } : {}) },
    // Deliberately NOT `note` — see the header comment. That a reason was
    // recorded is auditable; its text stays on the row.
    metadata: {
      category: existing.category,
      ngoId: existing.ngoId,
      noteRecorded: requiresNote(action) ? true : undefined,
    },
    request,
  });

  return NextResponse.json({ ok: true, status: transition.to }, { status: 200 });
}
