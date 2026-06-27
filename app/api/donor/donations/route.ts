import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "DONOR") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") || "ALL";
    const pageParam = parseInt(searchParams.get("page") || "1", 10);
    const limitParam = parseInt(searchParams.get("limit") || "10", 10);

    const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limit = isNaN(limitParam) || limitParam < 1 ? 10 : Math.min(limitParam, 50);

    const where: any = { donorId: session.user.id };
    
    // Status filter
    if (statusParam && statusParam !== "ALL") {
      where.status = statusParam;
    }

    const [donations, total] = await Promise.all([
      prisma.donation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          project: {
            select: {
              id: true,
              title: true,
              causeCategory: true,
              coverImage: true,
              ngo: { select: { id: true, orgName: true } },
            },
          },
          taxReceipt: {
            select: {
              receiptNumber: true,
              financialYear: true,
              pdfUrl: true,
              issuedAt: true,
            },
          },
        },
      }),
      prisma.donation.count({ where }),
    ]);

    return NextResponse.json({
      donations,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (error: any) {
    console.error("Error fetching donor donations:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch donations" },
      { status: 500 }
    );
  }
}
