import prisma from "@/lib/prisma";
import { deriveFcraStatus } from "@/lib/ngo-compliance";
import { sendAdminFcraQuarterlyReport } from "@/lib/email";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "inkvuex@gmail.com";

function currentQuarterLabel(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  const q = month < 3 ? 1 : month < 6 ? 2 : month < 9 ? 3 : 4;
  return `Q${q}-${year}`;
}

export interface FcraQuarterlyBreakdownItem {
  ngoId: string;
  orgName: string;
  fcraNumber: string | null;
  status: string;
  expiryDate: string | null;
}

export async function generateFcraQuarterlyReport(adminId?: string) {
  const records = await prisma.nGOCompliance.findMany({
    where: { fcraStatus: { not: "NONE" } },
    include: { ngo: { select: { id: true, orgName: true } } },
  });

  const breakdown: FcraQuarterlyBreakdownItem[] = [];
  let activeCount = 0;
  let expiringSoonCount = 0;
  let expiredCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;

  for (const c of records) {
    // derive live status for approved certs; keep stored status for others
    const liveStatus =
      c.fcraExpiryDate && ["ACTIVE", "EXPIRING_SOON", "EXPIRED"].includes(c.fcraStatus)
        ? (deriveFcraStatus(c.fcraExpiryDate) ?? c.fcraStatus)
        : c.fcraStatus;

    switch (liveStatus) {
      case "ACTIVE":          activeCount++;       break;
      case "EXPIRING_SOON":   expiringSoonCount++; break;
      case "EXPIRED":         expiredCount++;      break;
      case "REJECTED":        rejectedCount++;     break;
      default:                pendingCount++;      break;
    }

    breakdown.push({
      ngoId: c.ngoId,
      orgName: c.ngo.orgName,
      fcraNumber: c.fcraNumber,
      status: liveStatus as string,
      expiryDate: c.fcraExpiryDate ? c.fcraExpiryDate.toISOString() : null,
    });
  }

  const quarter = currentQuarterLabel();

  const report = await prisma.fcraQuarterlyReport.upsert({
    where: { quarter },
    create: {
      quarter,
      totalNgos: records.length,
      activeCount,
      expiringSoonCount,
      expiredCount,
      rejectedCount,
      pendingCount,
      ngoBreakdown: breakdown as unknown as any,
      generatedById: adminId ?? null,
    },
    update: {
      generatedAt: new Date(),
      totalNgos: records.length,
      activeCount,
      expiringSoonCount,
      expiredCount,
      rejectedCount,
      pendingCount,
      ngoBreakdown: breakdown as unknown as any,
      generatedById: adminId ?? null,
    },
  });

  try {
    await sendAdminFcraQuarterlyReport(ADMIN_EMAIL, {
      quarter,
      totalNgos: records.length,
      activeCount,
      expiringSoonCount,
      expiredCount,
      rejectedCount,
      pendingCount,
      reportId: report.id,
    });
  } catch (err) {
    console.error("[fcra-quarterly] failed to send admin email:", err);
  }

  return report;
}
