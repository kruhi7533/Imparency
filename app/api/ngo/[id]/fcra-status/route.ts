import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: params.id, isDeleted: false },
      select: {
        id: true,
        orgName: true,
        // fcraStatus may not exist if A1/A2 schema hasn't run yet
        // Use a try-catch or select with fallback
      },
    });

    if (!ngo) {
      return NextResponse.json({ error: "NGO not found" }, { status: 404 });
    }

    // Safely read fcraStatus — field may not exist in schema yet
    const fcraStatus = (ngo as any).fcraStatus ?? "NOT_REGISTERED";

    const isBlockedForForeign =
      fcraStatus !== "ACTIVE";

    return NextResponse.json({
      ngoId: params.id,
      fcraStatus,
      isBlockedForForeign,
      message:
        fcraStatus === "ACTIVE"
          ? "This NGO can accept foreign contributions."
          : fcraStatus === "EXPIRING_SOON"
          ? "This NGO's FCRA registration is expiring soon. Foreign contributions may be affected."
          : fcraStatus === "EXPIRED"
          ? "This NGO's FCRA registration has expired. Foreign contributions cannot be accepted."
          : "This NGO is not registered for foreign contributions (FCRA).",
    });
  } catch (err: any) {
    console.error("FCRA Status Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
