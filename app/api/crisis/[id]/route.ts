import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Despite the folder being named [id] (required so it matches the sibling
// join/campaigns/donate routes under app/api/crisis/[id]/*), this route is
// looked up by slug — the public-facing identifier — not the internal id.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const event = await prisma.crisisEvent.findUnique({
      where: { slug: params.id },
      include: {
        campaigns: {
          where: { status: "ACTIVE" },
          select: { id: true, title: true, coverImage: true, targetAmount: true, raisedAmount: true, ngo: { select: { orgName: true } } },
        },
        _count: { select: { participants: true, initiatives: true, updates: true } },
      },
    });

    if (!event || event.verificationStatus !== "VERIFIED" || event.isArchived) {
      return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });
    }

    return NextResponse.json({
      event: {
        ...event,
        totalRaised: Number(event.totalRaised),
        campaigns: event.campaigns.map((c) => ({
          ...c,
          targetAmount: Number(c.targetAmount),
          raisedAmount: Number(c.raisedAmount),
        })),
      },
    });
  } catch (err: any) {
    console.error("Crisis detail error:", err);
    return NextResponse.json({ error: "Failed to load crisis event" }, { status: 500 });
  }
}
