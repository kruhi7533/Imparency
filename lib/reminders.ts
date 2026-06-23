import prisma from "@/lib/prisma";
import {
  sendAdminPendingNGOsReminder,
  sendAdminUnreviewedProofsReminder,
  sendAdminUnresolvedFraudAlertsReminder,
  sendNGODocumentReminderEmail,
} from "@/lib/email";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "inkvuex@gmail.com";

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// NGOs stuck in PENDING verification > 5 days → email admin
export async function remindAdminPendingNGOs() {
  const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

  const pendingNGOs = await prisma.nGOProfile.findMany({
    where: {
      verificationStatus: "PENDING",
      createdAt: { lt: cutoff },
    },
    include: {
      user: { select: { email: true } },
    },
  });

  if (pendingNGOs.length === 0) return { sent: false, count: 0 };

  await sendAdminPendingNGOsReminder(
    ADMIN_EMAIL,
    pendingNGOs.map((n) => ({
      orgName: n.orgName,
      email: n.user.email,
      daysPending: daysSince(n.createdAt),
    }))
  );

  return { sent: true, count: pendingNGOs.length };
}

// PROOF_SUBMITTED milestones not reviewed > 3 days → email admin
export async function remindAdminUnreviewedProofs() {
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const staleProofs = await prisma.milestone.findMany({
    where: {
      status: "PROOF_SUBMITTED",
      updatedAt: { lt: cutoff },
    },
    include: {
      project: { include: { ngo: true } },
    },
  });

  if (staleProofs.length === 0) return { sent: false, count: 0 };

  await sendAdminUnreviewedProofsReminder(
    ADMIN_EMAIL,
    staleProofs.map((m) => ({
      milestoneTitle: m.title,
      orgName: m.project.ngo.orgName,
      daysWaiting: daysSince(m.updatedAt),
    }))
  );

  return { sent: true, count: staleProofs.length };
}

// Unresolved FRAUD_ALERT alerts > 7 days → email admin
export async function remindAdminUnresolvedFraudAlerts() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const staleAlerts = await prisma.fraudAlert.findMany({
    where: {
      resolved: false,
      alertCategory: "FRAUD_ALERT",
      createdAt: { lt: cutoff },
    },
  });

  if (staleAlerts.length === 0) return { sent: false, count: 0 };

  await sendAdminUnresolvedFraudAlertsReminder(
    ADMIN_EMAIL,
    staleAlerts.map((a) => ({
      type: a.type,
      orgOrDonor: a.entityId,
      daysOpen: daysSince(a.createdAt),
    }))
  );

  return { sent: true, count: staleAlerts.length };
}

// DOCUMENT_ERROR alerts unresolved > 7 days → email the NGO to resubmit
export async function remindNGODocumentErrors() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const staleDocErrors = await prisma.fraudAlert.findMany({
    where: {
      resolved: false,
      alertCategory: "DOCUMENT_ERROR",
      createdAt: { lt: cutoff },
    },
  });

  if (staleDocErrors.length === 0) return { sent: false, count: 0 };

  // Group by NGO entity so we send one email per NGO with all their issues listed
  const byNGO = new Map<string, { description: string }[]>();
  for (const alert of staleDocErrors) {
    if (!byNGO.has(alert.entityId)) byNGO.set(alert.entityId, []);
    byNGO.get(alert.entityId)!.push({ description: alert.description });
  }

  let emailsSent = 0;
  for (const [ngoId, alerts] of byNGO.entries()) {
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      include: { user: { select: { email: true } } },
    });

    if (!ngo) continue;

    await sendNGODocumentReminderEmail(
      ngo.user.email,
      ngo.orgName,
      alerts.map((a) => a.description)
    );
    emailsSent++;
  }

  return { sent: true, count: emailsSent };
}

// Run all four checks in sequence
export async function runAllAdminReminders() {
  const results = await Promise.allSettled([
    remindAdminPendingNGOs(),
    remindAdminUnreviewedProofs(),
    remindAdminUnresolvedFraudAlerts(),
    remindNGODocumentErrors(),
  ]);

  return {
    pendingNGOs: results[0].status === "fulfilled" ? results[0].value : { error: String(results[0].reason) },
    unreviewedProofs: results[1].status === "fulfilled" ? results[1].value : { error: String(results[1].reason) },
    fraudAlerts: results[2].status === "fulfilled" ? results[2].value : { error: String(results[2].reason) },
    documentErrors: results[3].status === "fulfilled" ? results[3].value : { error: String(results[3].reason) },
  };
}
