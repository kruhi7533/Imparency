import prisma from "@/lib/prisma";

/**
 * Append-only donor lifecycle events — powers the Donor 360 timeline.
 * Best-effort: never throws (mirrors logAdminAction / logComplianceEvent).
 */

export type DonorEventType =
  | "CATEGORY_DECLARED"
  | "PAN_SUBMITTED"
  | "PAN_VERIFIED"
  | "PAN_VERIFICATION_FAILED"
  | "PAN_CLEARED"
  | "PAN_MANUALLY_VERIFIED"
  | "PAN_MANUALLY_REJECTED"
  // Donor organisation verification. SUBMITTED is written by the donor's own
  // profile save; the other two only ever by an admin decision.
  | "CSR_ORG_SUBMITTED"
  | "CSR_ORG_VERIFIED"
  | "CSR_ORG_REJECTED"
  /// An approved company edited its own name or CIN, which retires the
  /// approval. Recorded because "why did this go back to pending" is the first
  /// question anyone will ask.
  | "CSR_ORG_REOPENED";

export type DonorEventSource = "USER" | "ADMIN" | "SYSTEM" | "WEBHOOK";

export async function logDonorEvent(params: {
  donorId: string;
  eventType: DonorEventType;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  initiatedBy?: string | null;
  source: DonorEventSource;
}): Promise<void> {
  try {
    await prisma.donorEvent.create({
      data: {
        donorId: params.donorId,
        eventType: params.eventType,
        oldValue: (params.oldValue as any) ?? undefined,
        newValue: (params.newValue as any) ?? undefined,
        initiatedBy: params.initiatedBy ?? null,
        source: params.source,
      },
    });
  } catch (err) {
    console.error(`[donor-events] FAILED to log ${params.eventType} for donor ${params.donorId}:`, err);
  }
}
