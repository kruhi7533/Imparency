import prisma from "@/lib/prisma";
import { deriveFcraStatus, logComplianceEvent } from "@/lib/ngo-compliance";
import { sendFcraExpiryReminderEmail, sendAdminFcraExpiryDigest } from "@/lib/email";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "inkvuex@gmail.com";

function daysUntil(date: Date): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * Keeps FCRA statuses truthful: walks every approved certificate, recomputes its
 * status from the expiry date, and persists + logs + notifies on each transition.
 * Designed for a daily cron (mirrors lib/reminders.ts).
 */
export async function runFcraExpiryMaintenance() {
  // Only certificates that have been approved and have an expiry are time-sensitive.
  const records = await prisma.nGOCompliance.findMany({
    where: {
      fcraStatus: { in: ["ACTIVE", "EXPIRING_SOON", "EXPIRED"] },
      fcraExpiryDate: { not: null },
    },
    include: { ngo: { select: { orgName: true, user: { select: { email: true } } } } },
  });

  let transitioned = 0;
  let alertsSent = 0;
  const digest: { orgName: string; status: string; daysLeft: number }[] = [];

  for (const c of records) {
    const newStatus = deriveFcraStatus(c.fcraExpiryDate);
    if (!newStatus || newStatus === c.fcraStatus) continue;

    await prisma.nGOCompliance.update({
      where: { id: c.id },
      data: { fcraStatus: newStatus },
    });
    transitioned++;

    const daysLeft = c.fcraExpiryDate ? daysUntil(c.fcraExpiryDate) : 0;

    if (newStatus === "EXPIRING_SOON") {
      await logComplianceEvent(c.id, "FCRA_EXPIRING_SOON", `FCRA expires in ${daysLeft} days.`, null);
    } else if (newStatus === "EXPIRED") {
      await logComplianceEvent(c.id, "FCRA_EXPIRED", "FCRA registration has expired.", null);
    }

    try {
      await sendFcraExpiryReminderEmail(c.ngo.user.email, c.ngo.orgName, daysLeft);
      alertsSent++;
    } catch (err) {
      console.error("Failed to send FCRA expiry email:", err);
    }
    digest.push({ orgName: c.ngo.orgName, status: newStatus, daysLeft });
  }

  if (digest.length > 0) {
    try {
      await sendAdminFcraExpiryDigest(ADMIN_EMAIL, digest);
    } catch (err) {
      console.error("Failed to send admin FCRA digest:", err);
    }
  }

  return { transitioned, alertsSent };
}
