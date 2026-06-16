import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

export async function GET(
  request: Request,
  { params }: { params: { donationId: string } }
) {
  const { donationId } = params;

  const auth = await verifySessionRole();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const donation = await prisma.donation.findUnique({
      where: { id: donationId },
      include: {
        project: {
          select: { title: true }
        }
      }
    });

    if (!donation) {
      return NextResponse.json({ error: "Donation not found" }, { status: 404 });
    }

    if (donation.donorId !== auth.session.user.id && auth.session.user.role !== Role.ADMIN) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      status: donation.status,
      amount: donation.amount,
      projectTitle: donation.project.title,
      receiptUrl: donation.receiptUrl,
      createdAt: donation.createdAt,
    });
  } catch (err: any) {
    console.error("Status check error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
