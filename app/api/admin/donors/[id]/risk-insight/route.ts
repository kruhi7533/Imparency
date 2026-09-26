import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { generateDonorRiskInsight } from "@/lib/gemini/donor-risk-insight";

export const runtime = "nodejs";

/**
 * ADMIN-only, on-demand. Generates a plain-English risk read for a donor from
 * signals we already record (PAN state, velocity, fraud alerts, category
 * history). Never changes donor status — purely advisory.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  const rl = await checkRateLimit(request, "admin/donor-risk-insight", 20, 60);
  if (rl.isBlocked) return rl.response!;

  try {
    const donor = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        role: true,
        panStatus: true,
        panVerifiedVia: true,
        panNameMatch: true,
        donorCategory: true,
        createdAt: true,
        donations: { select: { status: true, createdAt: true } },
      },
    });
    if (!donor || donor.role !== "DONOR") {
      return NextResponse.json({ error: "Donor not found" }, { status: 404 });
    }

    const [openAlerts, categoryDowngradeEvent] = await Promise.all([
      prisma.fraudAlert.findMany({
        where: { entityType: "DONOR", entityId: donor.id, resolved: false },
        select: { severity: true },
      }),
      prisma.donorEvent.findFirst({
        where: { donorId: donor.id, eventType: "CATEGORY_DECLARED" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const donationsLast24h = donor.donations.filter((d) => d.createdAt >= twentyFourHoursAgo).length;
    const accountAgeDays = Math.floor((Date.now() - donor.createdAt.getTime()) / (1000 * 60 * 60 * 24));

    // A category downgrade that followed an earlier FCRA-required declaration
    // is the gate-evasion pattern flagged as DONOR_CATEGORY_DOWNGRADE.
    const categoryDowngradedFromFcra = await prisma.fraudAlert.findFirst({
      where: { type: "DONOR_CATEGORY_DOWNGRADE", entityId: donor.id, entityType: "DONOR" },
    });

    const insight = await generateDonorRiskInsight({
      donorName: donor.name,
      panStatus: donor.panStatus,
      panVerifiedVia: donor.panVerifiedVia,
      panNameMatch: donor.panNameMatch,
      donorCategory: donor.donorCategory,
      categoryDowngradedFromFcra: !!categoryDowngradedFromFcra,
      totalDonations: donor.donations.length,
      successfulDonations: donor.donations.filter((d) => d.status === "SUCCESS").length,
      failedDonations: donor.donations.filter((d) => d.status === "FAILED").length,
      donationsLast24h,
      openFraudAlerts: openAlerts.length,
      highSeverityFraudAlerts: openAlerts.filter((a) => a.severity === "HIGH").length,
      accountAgeDays,
    });

    return NextResponse.json({ insight });
  } catch (err: any) {
    console.error("Donor risk insight route error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
