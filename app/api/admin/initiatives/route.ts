import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";

export async function GET(request: Request) {
  try {
    const { authorized, response } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const initiatives = await prisma.reliefInitiative.findMany({
      where: status ? { status: status as any } : undefined,
      select: {
        id: true, organizerName: true, organizerType: true, location: true,
        requiredFunds: true, raisedAmount: true, status: true, createdAt: true,
        crisisEvent: { select: { title: true, slug: true } },
        submittedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      initiatives: initiatives.map((i) => ({ ...i, requiredFunds: Number(i.requiredFunds), raisedAmount: Number(i.raisedAmount) })),
    });
  } catch (err: any) {
    console.error("Admin initiative list error:", err);
    return NextResponse.json({ error: "Failed to load initiatives" }, { status: 500 });
  }
}
