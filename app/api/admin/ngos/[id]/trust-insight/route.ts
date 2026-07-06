import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { generateNgoTrustInsight } from "@/lib/gemini/ngo-trust-insight";
import { computeCompliance, deriveFcraStatus, hasVerifiedImpactProof } from "@/lib/ngo-compliance";

export const runtime = "nodejs";

/**
 * ADMIN-only, on-demand. Generates a plain-English trust read for an NGO from
 * signals we already compute (health score, compliance score, fraud alerts,
 * overdue milestones). Purely advisory — never changes NGO status.
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  const rl = await checkRateLimit(_request, "admin/ngo-trust-insight", 20, 60);
  if (rl.isBlocked) return rl.response!;

  try {
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: params.id },
      include: {
        compliance: true,
        projects: {
          select: {
            raisedAmount: true,
            milestones: {
              select: { status: true, deadline: true, targetAmount: true },
            },
          },
        },
      },
    });
    if (!ngo) {
      return NextResponse.json({ error: "NGO not found" }, { status: 404 });
    }

    const [openAlerts, hasImpact] = await Promise.all([
      prisma.fraudAlert.findMany({
        where: { entityType: "NGO", entityId: ngo.id, resolved: false },
        select: { severity: true },
      }),
      hasVerifiedImpactProof(ngo.id),
    ]);

    const compliance = computeCompliance(ngo.compliance, hasImpact);
    const fcraBadge = ngo.compliance?.fcraExpiryDate
      ? deriveFcraStatus(ngo.compliance.fcraExpiryDate) ?? ngo.compliance.fcraStatus
      : ngo.compliance?.fcraStatus ?? "NONE";

    const allMilestones = ngo.projects.flatMap((p) => p.milestones);
    const now = new Date();
    const overdueMilestones = allMilestones.filter(
      (m) => ["PENDING", "IN_PROGRESS"].includes(m.status) && m.deadline < now
    ).length;
    const completedMilestones = allMilestones.filter((m) => ["COMPLETED", "VERIFIED"].includes(m.status)).length;
    const raisedAmount = ngo.projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0);
    const verifiedMilestoneAmount = allMilestones
      .filter((m) => ["COMPLETED", "VERIFIED"].includes(m.status))
      .reduce((sum, m) => sum + Number(m.targetAmount), 0);

    const insight = await generateNgoTrustInsight({
      orgName: ngo.orgName,
      healthScore: ngo.healthScore != null ? Number(ngo.healthScore) : null,
      complianceScore: compliance.score,
      fcraBadge: fcraBadge as string,
      openFraudAlerts: openAlerts.length,
      highSeverityFraudAlerts: openAlerts.filter((a) => a.severity === "HIGH").length,
      overdueMilestones,
      totalMilestones: allMilestones.length,
      completedMilestones,
      raisedAmount,
      verifiedMilestoneAmount,
    });

    return NextResponse.json({ insight });
  } catch (err: any) {
    console.error("NGO trust insight route error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
