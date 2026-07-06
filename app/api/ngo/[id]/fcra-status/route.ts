import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { deriveFcraStatus } from "@/lib/ngo-compliance";

export const runtime = "nodejs";

/**
 * Public-read endpoint — no auth required.
 * The UI calls this before showing the donate button to international donors.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const compliance = await prisma.nGOCompliance.findUnique({
    where: { ngoId: params.id },
    select: { fcraStatus: true, fcraExpiryDate: true },
  });

  if (!compliance) {
    return NextResponse.json({ fcraStatus: "NONE", fcraRequired: false });
  }

  const liveStatus =
    compliance.fcraExpiryDate &&
    ["ACTIVE", "EXPIRING_SOON", "EXPIRED"].includes(compliance.fcraStatus)
      ? (deriveFcraStatus(compliance.fcraExpiryDate) ?? compliance.fcraStatus)
      : compliance.fcraStatus;

  return NextResponse.json({
    fcraStatus: liveStatus,
    fcraActive: liveStatus === "ACTIVE",
  });
}
