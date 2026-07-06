import { NextRequest, NextResponse } from "next/server";
import { approvePayment } from "@/lib/payment-service";

export async function GET(
  request: NextRequest,
  { params }: { params: { donationId: string; token: string } }
) {
  const { donationId, token } = params;
  const baseUrl = new URL(request.url).origin;

  try {
    const result = await approvePayment(donationId, token);

    if (result.success) {
      return NextResponse.redirect(
        `${baseUrl}/donor/donation-success?donationId=${donationId}`
      );
    } else {
      return NextResponse.redirect(
        `${baseUrl}/donor/donation-failed?donationId=${donationId}&reason=${result.reason || "unknown"}`
      );
    }
  } catch (error: any) {
    console.error("[approve route] Error approving donation:", error);
    return NextResponse.redirect(
      `${baseUrl}/donor/donation-failed?donationId=${donationId}&reason=internal_error`
    );
  }
}
