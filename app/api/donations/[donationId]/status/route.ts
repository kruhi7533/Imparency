import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { donationId: string } }
) {
  const { donationId } = params;

  try {
    const donation = await (prisma as any).donation.findUnique({
      where: { id: donationId },
      select: {
        status: true,
        tokenExpiresAt: true,
        amount: true,
        project: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!donation) {
      return NextResponse.json({ error: "Donation not found" }, { status: 404 });
    }

    let status = donation.status;

    // Lazily evaluate token expiry
    if (
      (status as any) === "PENDING_APPROVAL" &&
      (donation as any).tokenExpiresAt &&
      new Date((donation as any).tokenExpiresAt) < new Date()
    ) {
      await (prisma as any).donation.update({
        where: { id: donationId },
        data: {
          status: "EXPIRED",
          approvalTokenHash: null,
          tokenExpiresAt: null,
        } as any,
      });
      status = "EXPIRED" as any;
    }

    return NextResponse.json({
      status,
      amount: donation.amount,
      projectTitle: donation.project?.title,
    });
  } catch (error: any) {
    console.error("[status route] Error checking donation status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
