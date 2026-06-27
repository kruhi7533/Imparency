import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { FcraQuarterlyBreakdownItem } from "@/lib/fcra-quarterly";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
