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
  | "PAN_MANUALLY_REJECTED";

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
