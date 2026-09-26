import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { checkRateLimit } from "@/lib/rate-limiter";

export async function GET(
  request: Request,
  { params }: { params: { donationId: string } }
) {
  const { donationId } = params;

  const auth = await verifySessionRole();
  if (!auth.authorized) {
    return auth.response;
  }

  // This endpoint is polled, not clicked: the pending page hits it every 3s for
  // up to 10 attempts. The limit only exists to stop id enumeration, so it has
  // to sit well clear of legitimate polling — 60/min is 1/s, three times the
  // poll rate, with room for a donor holding several tabs open.
  const rl = await checkRateLimit(request, "donations/status", 60, 60);
  if (rl.isBlocked) return rl.response!;

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
