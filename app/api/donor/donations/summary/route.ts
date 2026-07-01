import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "DONOR") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [successData, pendingCount, failedCount] = await Promise.all([
      prisma.donation.aggregate({
        where: { donorId: session.user.id, status: "SUCCESS" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.donation.count({
        where: { donorId: session.user.id, status: "PENDING" }
      }),
      prisma.donation.count({
        where: { donorId: session.user.id, status: "FAILED" }
      }),
    ]);

    return NextResponse.json({
      totalDonated: Number(successData._sum.amount ?? 0),
      successCount: successData._count ?? 0,
      pendingCount: pendingCount ?? 0,
      failedCount: failedCount ?? 0,
    });
  } catch (error: any) {
    console.error("Error fetching donor donations summary:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch summary" },
      { status: 500 }
    );
  }
}
