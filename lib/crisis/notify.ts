import prisma from "@/lib/prisma";

/**
 * Fan-out for a Crisis Event's ACTIVE transition. Inserts one PENDING
 * CrisisNotificationDelivery row per opted-in donor per channel (EMAIL,
 * IN_APP). The unique constraint on (crisisEventId, donorId, channel) is the
 * actual dedup guarantee — calling this twice for the same event is safe and
 * a no-op on the second call, by construction, not by a check here.
 *
 * Call this exactly once, at the moment a crisis event's status flips to
 * ACTIVE — never on routine edits (severity changes, etc.) to avoid alert
 * fatigue. The cron drainer (/api/cron/crisis-notify) does the actual sending.
 */
export async function fanOutCrisisNotifications(crisisEventId: string): Promise<{ recipients: number }> {
  const donors = await prisma.user.findMany({
    where: { role: "DONOR", crisisAlertsOptOut: false },
    select: { id: true },
  });

  if (donors.length === 0) return { recipients: 0 };

  const rows = donors.flatMap((d) => [
    { crisisEventId, donorId: d.id, channel: "EMAIL" as const },
    { crisisEventId, donorId: d.id, channel: "IN_APP" as const },
  ]);

  // skipDuplicates makes this safe to call more than once for the same event
  // (defense in depth on top of the DB-level unique constraint).
  await prisma.crisisNotificationDelivery.createMany({ data: rows, skipDuplicates: true });

  return { recipients: donors.length };
}
