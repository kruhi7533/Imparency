import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveDonorAccount, donorCan } from "@/lib/donor-team";
import { loadReportFigures, serializeReport } from "@/lib/contract-impact-reports";

export const dynamic = "force-dynamic";

/**
 * GET /api/donor/contract-reports[?contractId=] — PUBLISHED stored impact
 * reports on the caller's donor account's contracts. Drafts and reports in
 * review never reach a donor. Figures go through claimDisplay(): an unbacked
 * figure reads "unverified", never 0.
 */
export async function GET(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.DONOR);
    if (!authorized) return response;
    const account = await resolveDonorAccount(session.user.id);

    const contractId = new URL(request.url).searchParams.get("contractId");
    const reports = await prisma.contractImpactReport.findMany({
      where: { donorId: account.accountId, status: "PUBLISHED", ...(contractId ? { contractId } : {}) },
      orderBy: { publishedAt: "desc" },
      take: 50,
    });
    const requests = reports.length
      ? await prisma.renewalRequest.findMany({ where: { reportId: { in: reports.map((r) => r.id) } } })
      : [];

    const out = await Promise.all(
      reports.map(async (r) => ({
        ...serializeReport(r),
        // The admin's review note is internal (why a draft was returned); a
        // donor sees the published report only.
        reviewNote: null,
        figures: (await loadReportFigures(r)).figures,
        requests: requests
          .filter((q) => q.reportId === r.id)
          .map((q) => ({
            id: q.id,
            kind: q.kind,
            status: q.status,
            message: q.message,
            proposedAmount: q.proposedAmount?.toString() ?? null,
            ngoResponse: q.ngoResponse,
            respondedAt: q.respondedAt?.toISOString() ?? null,
          })),
      })),
    );
    return NextResponse.json({ reports: out, canRequest: donorCan(account.role, "decide") });
  } catch (error) {
    console.error("[api/donor/contract-reports] GET error:", error);
    return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
  }
}
