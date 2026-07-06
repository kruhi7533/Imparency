import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { FcraQuarterlyBreakdownItem } from "@/lib/fcra-quarterly";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { authorized, response } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  const report = await prisma.fcraQuarterlyReport.findUnique({
    where: { id: params.id },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const breakdown = report.ngoBreakdown as unknown as FcraQuarterlyBreakdownItem[];

  const header = "NGO ID,Organisation Name,FCRA Number,Status,Expiry Date\n";
  const rows = breakdown
    .map((r) =>
      [
        r.ngoId,
        `"${r.orgName.replace(/"/g, '""')}"`,
        r.fcraNumber ?? "",
        r.status,
        r.expiryDate ? new Date(r.expiryDate).toISOString().slice(0, 10) : "",
      ].join(",")
    )
    .join("\n");

  const csv = header + rows;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="fcra-report-${report.quarter}.csv"`,
    },
  });
}
