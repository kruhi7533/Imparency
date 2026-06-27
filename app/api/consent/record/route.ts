import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ConsentPurpose } from "@prisma/client";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId, purpose, policyVersion, ipAddress } = body;

    if (!userId || !purpose) {
      return NextResponse.json({ error: "Missing required fields: userId and purpose" }, { status: 400 });
    }

    // Validate purpose enum
    if (purpose !== "ACCOUNT_CREATION" && purpose !== "DONATION_DATA_SHARING") {
      return NextResponse.json({ error: "Invalid consent purpose" }, { status: 400 });
    }

    // Security check: Only the authenticated user can log their own consent
    if (session.user.id !== userId) {
      return NextResponse.json({ error: "Forbidden: Cannot record consent for another user" }, { status: 403 });
    }

    try {
      await prisma.consentLog.create({
        data: {
          userId,
          purpose: purpose as ConsentPurpose,
          policyVersion: policyVersion || "1.0",
          ipAddress: ipAddress || null,
        },
      });
    } catch (dbErr) {
      // Soft-fail: Console error but return success to avoid breaking flows
      console.error("DPDP Consent Logging DB Failure (soft-failed):", dbErr);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Consent Record Route Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
