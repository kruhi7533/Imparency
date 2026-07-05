import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import { issueTaxReceipt } from "@/lib/tax-receipt";

export const runtime = "nodejs";

/**
 * DONOR-only. Just-in-time recovery path: after a donor verifies their PAN,
 * generate 80G receipts for their past successful donations that don't have one
 * yet (these were withheld at payment time because the PAN wasn't verified).
 */
export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.DONOR);
  if (!auth.authorized) return auth.response;

  const rl = await checkRateLimit(request, "donor/receipts/claim", 10, 60);
  if (rl.isBlocked) return rl.response!;

  const donorId = auth.session.user.id;

  try {
    const donor = await prisma.user.findUnique({
      where: { id: donorId },
      select: { panStatus: true, panNumber: true },
    });

    if (!donor?.panNumber || donor.panStatus !== "VERIFIED") {
      return NextResponse.json(
        { error: "Verify your PAN before claiming 80G receipts." },
        { status: 400 }
      );
    }

    // Successful donations with no receipt yet.
    const pending = await prisma.donation.findMany({
      where: { donorId, status: "SUCCESS", taxReceipt: null },
      select: { id: true },
    });

    let issued = 0;
    const errors: string[] = [];
    for (const d of pending) {
      try {
        await issueTaxReceipt(d.id, { trigger: "CLAIM", actorId: donorId }); // idempotent
        issued++;
      } catch (err: any) {
        console.error(`Claim receipt failed for donation ${d.id}:`, err);
        errors.push(d.id);
      }
    }

    return NextResponse.json({ success: true, issued, failed: errors.length });
  } catch (err: any) {
    console.error("Receipt claim route error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
