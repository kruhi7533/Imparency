import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const disasterType = searchParams.get("disasterType");
    const country = searchParams.get("country");
    const stateName = searchParams.get("state");
    const city = searchParams.get("city");
    const severity = searchParams.get("severity");
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(24, Math.max(1, parseInt(searchParams.get("pageSize") || "12", 10) || 12));

    const where: Prisma.CrisisEventWhereInput = {
      verificationStatus: "VERIFIED",
      isArchived: false,
      ...(disasterType ? { disasterType: disasterType as any } : {}),
      ...(country ? { country } : {}),
      ...(stateName ? { stateName } : {}),
      ...(city ? { city } : {}),
      ...(severity ? { severity: severity as any } : {}),
      ...(status ? { status: status as any } : { status: { in: ["UPCOMING", "ACTIVE", "CLOSED"] } }),
    };

    const [events, totalCount] = await Promise.all([
      prisma.crisisEvent.findMany({
        where,
        select: {
          id: true, title: true, slug: true, disasterType: true, severity: true,
          affectedLocation: true, country: true, stateName: true, city: true,
          coverImage: true, status: true, isFeatured: true,
          totalRaised: true, totalDonors: true, totalNgos: true, totalCampaigns: true,
          startDate: true, expectedEndDate: true,
        },
        // Featured + active events surface first, then most recently started.
        orderBy: [{ isFeatured: "desc" }, { status: "asc" }, { startDate: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.crisisEvent.count({ where }),
    ]);

    return NextResponse.json({
      events: events.map((e) => ({ ...e, totalRaised: Number(e.totalRaised) })),
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (err: any) {
    console.error("Crisis list error:", err);
    return NextResponse.json({ error: "Failed to load crisis events" }, { status: 500 });
  }
}
