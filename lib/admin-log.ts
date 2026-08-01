import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";

/**
 * Admin action audit trail (Phase 1 — admin accountability).
 *
 * Every sensitive admin mutation calls logAdminAction() so audits can answer
 * "who changed this, when, from where, and what exactly changed".
 *
 * Best-effort: never throws — an audit-log failure must not break the action
 * itself (mirrors logComplianceEvent in lib/ngo-compliance.ts). Failures are
 * logged loudly server-side instead.
 *
 * oldValue/newValue must be snapshots of ONLY the fields the action touched
 * (e.g. { verificationStatus: "PENDING" } → { verificationStatus: "VERIFIED" }),
 * never full entity dumps — the log outlives PII retention on the main tables.
 */

/**
 * Closed set of admin action types. TS-level union (not a Prisma enum) so
 * adding an action is a code change, not a DB migration — while analytics and
 * filters still get compile-time safety at every call site.
 */
export type AdminAction =
  | "NGO_APPROVED"
  | "NGO_REJECTED"
  | "NGO_SUSPENDED"
  | "NGO_FLAGGED_FOR_RISK"
  | "PROJECT_APPROVED"
  | "PROJECT_REJECTED"
  | "PROOF_APPROVED"
  | "PROOF_REJECTED"
  | "FCRA_APPROVED"
  | "FCRA_REJECTED"
  | "FCRA_REUPLOAD_REQUESTED"
  | "ALERT_RESOLVED"
  | "RISK_REVIEW_CLEARED"
  | "RISK_REVIEW_ESCALATED"
  | "NGO_INQUIRY_SENT"
  | "THREAD_REPLIED"
  | "THREAD_RESOLVED"
  | "PAN_MANUALLY_VERIFIED"
  | "PAN_MANUALLY_REJECTED"
  | "REMINDERS_SENT"
  | "SETTING_UPDATED"
  | "CRISIS_EVENT_CREATED"
  | "CRISIS_EVENT_UPDATED"
  | "CRISIS_EVENT_VERIFIED"
  | "CRISIS_EVENT_REJECTED"
  | "CRISIS_EVENT_FEATURED"
  | "CRISIS_EVENT_UNFEATURED"
  | "CRISIS_EVENT_ARCHIVED"
  | "INITIATIVE_VERIFIED"
  | "INITIATIVE_REJECTED";

export interface AdminActionParams {
  adminId: string;
  action: AdminAction;
  entityType: "NGO" | "DONOR" | "PROJECT" | "MILESTONE" | "FRAUD_ALERT" | "RISK_REVIEW" | "FCRA" | "THREAD" | "SYSTEM" | "SETTING" | "CRISIS_EVENT" | "RELIEF_INITIATIVE";
  entityId: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  note?: string | null;
  /** AI-vs-human decision snapshot, disagreement reasons, counts, etc. */
  metadata?: Record<string, unknown> | null;
  /** Pass the incoming Request to capture IP + user agent automatically. */
  request?: Request | null;
}

/** Extract client IP + user agent from a Request (same header logic as rate-limiter). */
export function requestMeta(request: Request | null | undefined): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  if (!request) return { ipAddress: null, userAgent: null };
  const xForwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress = xForwardedFor
    ? xForwardedFor.split(",")[0].trim()
    : request.headers.get("x-real-ip") || null;
  const userAgent = request.headers.get("user-agent") || null;
  return { ipAddress, userAgent };
}

export async function logAdminAction(params: AdminActionParams): Promise<void> {
  try {
    const { ipAddress, userAgent } = requestMeta(params.request);
    await prisma.adminActionLog.create({
      data: {
        adminId: params.adminId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValue: (params.oldValue as any) ?? undefined,
        newValue: (params.newValue as any) ?? undefined,
        note: params.note ?? null,
        metadata: (params.metadata as any) ?? undefined,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    // The action itself already succeeded; only its audit record is missing.
    // That's an accountability hole an auditor would care about, so it must be
    // visible rather than sitting in an ephemeral log line.
    captureError(
      err,
      {
        scope: "lib/admin-log",
        operation: "record_admin_action",
        entityType: params.entityType,
        entityId: params.entityId,
        userId: params.adminId,
        extra: { adminAction: params.action },
      },
      "fatal"
    );
  }
}
