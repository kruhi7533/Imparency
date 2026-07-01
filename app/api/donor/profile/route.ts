import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "DONOR") {
      return NextResponse.json({ error: "Only donors can update donor profiles" }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      phone,
      city,
      billingAddress,
      panNumber,
      isCorporate,
      companyName,
      gstNumber,
    } = body;

    // Validate name
    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const trimmedName = name.trim();

    // ── PAN verification (risk-based / just-in-time) ───────────────────────────
    // A verified PAN is what gates 80G receipt issuance, so we verify it here on
    // save rather than at signup. Fields default to "clear PAN → UNVERIFIED".
    const normalizedPan = panNumber ? panNumber.trim().toUpperCase() : null;
    let panData: {
      panStatus: "UNVERIFIED" | "VERIFIED" | "FAILED" | "PROVIDER_ERROR";
      panVerifiedAt: Date | null;
      panVerifiedVia: "MOCK" | "SUREPASS" | "MANUAL_ADMIN" | null;
      panRegisteredName: string | null;
      panNameMatch: boolean | null;
    } | null = null;
    let panMismatch = false;

    if (normalizedPan) {
      // 1. Format pre-check before hitting the provider.
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalizedPan)) {
        return NextResponse.json(
          { error: "Invalid PAN format. Expected 10 characters like ABCDE1234F." },
          { status: 400 }
        );
      }

      // 2. Skip re-verification if the PAN is unchanged and already verified.
      const current = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { panNumber: true, panStatus: true },
      });
      const alreadyVerified =
        current?.panStatus === "VERIFIED" &&
        current.panNumber?.trim().toUpperCase() === normalizedPan;

      if (!alreadyVerified) {
        const { verifyPan, namesMatch } = await import("@/lib/pan-verification");
        const r = await verifyPan(normalizedPan);

        if (!r.valid) {
          return NextResponse.json(
            { error: "PAN could not be verified in government records. Please check and resubmit." },
            { status: 400 }
          );
        }

        // r.error present = provider failed open (unavailable) — retryable, not a pass.
        const providerError = !!r.error;
        const nameMatch = r.registeredName ? namesMatch(trimmedName, r.registeredName) : null;
        panMismatch = !providerError && nameMatch === false;

        panData = {
          panStatus: providerError ? "PROVIDER_ERROR" : "VERIFIED",
          panVerifiedAt: providerError ? null : new Date(),
          panVerifiedVia: process.env.SUREPASS_API_TOKEN ? "SUREPASS" : "MOCK",
          panRegisteredName: r.registeredName ?? null,
          panNameMatch: nameMatch,
        };
      }
    } else {
      // PAN cleared → reset verification state.
      panData = {
        panStatus: "UNVERIFIED",
        panVerifiedAt: null,
        panVerifiedVia: null,
        panRegisteredName: null,
        panNameMatch: null,
      };
    }

    // Update user profile in database
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: trimmedName,
        phone: phone ? phone.trim() : null,
        city: city ? city.trim() : null,
        billingAddress: billingAddress ? billingAddress.trim() : null,
        panNumber: normalizedPan,
        isCorporate: !!isCorporate,
        companyName: isCorporate && companyName ? companyName.trim() : null,
        gstNumber: isCorporate && gstNumber ? gstNumber.trim() : null,
        ...(panData ?? {}),
      },
    });

    // Name-mismatch → verified but flagged for admin (mirrors NGO registration).
    if (panMismatch) {
      const { createFraudAlert } = await import("@/lib/fraud-alerts");
      await createFraudAlert(
        "PAN_API_MISMATCH",
        updatedUser.id,
        "DONOR",
        `Donor name "${trimmedName}" does not match the name registered to this PAN in government records.`,
        "HIGH",
        "FRAUD_ALERT",
        "PAN_API_MISMATCH"
      );
    }

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        phone: updatedUser.phone,
        city: updatedUser.city,
        billingAddress: updatedUser.billingAddress,
        panNumber: updatedUser.panNumber,
        panStatus: updatedUser.panStatus,
        panNameMatch: updatedUser.panNameMatch,
        isCorporate: updatedUser.isCorporate,
        companyName: updatedUser.companyName,
        gstNumber: updatedUser.gstNumber,
      },
    });
  } catch (error: any) {
    console.error("Donor profile update error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update profile" },
      { status: 500 }
    );
  }
}
