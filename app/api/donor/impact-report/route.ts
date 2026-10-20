import { resolveDonorAccount } from "@/lib/donor-team";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { impactReportCsv, loadDonorImpact } from "@/lib/donor-impact";

export const runtime = "nodejs";

/**
 * GET /api/donor/impact-report — the signed-in donor's impact report as CSV.
 * Scoped to the session's own contracts and donations; there is no id
 * parameter to tamper with. Unverified figures are exported as "unverified".
 */
export async function GET() {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  const csv = impactReportCsv(await loadDonorImpact((await resolveDonorAccount(session.user.id)).accountId));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="impact-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
