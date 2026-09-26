import prisma from "@/lib/prisma";

/**
 * Append-only CSR requirement timeline. State changes write their event inside
 * the same transaction as the change (pass the `tx`), so a status change can
 * never exist without its audit row. Admin decisions are also mirrored to
 * AdminActionLog via logAdminAction() by the workflow service.
 */
export type RequirementAuditAction =
  | "CSR_UPLOADED"
  | "REQUIREMENT_CREATED_FROM_FORM"
  | "CSR_HASH_DUPLICATE"
  | "CSR_PROCESSING_STARTED"
  | "CSR_EXTRACTION_COMPLETED"
  | "CSR_EXTRACTION_FAILED"
  | "CSR_DOCUMENT_ACCESSED"
  | "REQUIREMENT_REVIEW_STARTED"
  | "REQUIREMENT_EDITED_BY_DONOR"
  | "REQUIREMENT_SUBMITTED_FOR_ADMIN_REVIEW"
  | "REQUIREMENT_EDITED_BY_ADMIN"
  | "REQUIREMENT_VALIDATED"
  | "REQUIREMENT_CORRECTION_REQUESTED"
  | "REQUIREMENT_REJECTED"
  | "REQUIREMENT_EXTRACTION_RERUN"
  | "REQUIREMENT_MATCHING_STARTED"
  | "GAP_ANALYSIS_COMPLETED"
  | "MATCHING_FAILED"
  | "SHORTLIST_CREATED"
  | "GAP_REPORT_APPROVED"
  | "GAP_REPORT_REJECTED"
  | "OPPORTUNITY_SHARED"
  | "NGO_INTEREST_SUBMITTED"
  | "NGO_SELECTED"
  | "CONTRACT_INITIATED";

export interface RequirementAuditEvent {
  requirementId: string;
  action: RequirementAuditAction;
  actorId: string | null;
  actorRole: "DONOR" | "NGO" | "ADMIN" | "SYSTEM";
  fromStatus?: string | null;
  toStatus?: string | null;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Either the shared client or an interactive transaction on it. */
type Db = Pick<typeof prisma, "requirementAuditLog">;

export async function recordRequirementEvent(db: Db, event: RequirementAuditEvent): Promise<void> {
  await db.requirementAuditLog.create({
    data: {
      requirementId: event.requirementId,
      action: event.action,
      actorId: event.actorId,
      actorRole: event.actorRole,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      detail: event.detail ?? null,
      metadata: (event.metadata as any) ?? undefined,
    },
  });
}

/** For events that must not break the request if logging fails (e.g. file access). */
export async function recordRequirementEventBestEffort(event: RequirementAuditEvent): Promise<void> {
  try {
    await recordRequirementEvent(prisma, event);
  } catch (err) {
    console.error(`[requirement-audit] FAILED to record ${event.action} on ${event.requirementId}:`, err);
  }
}
