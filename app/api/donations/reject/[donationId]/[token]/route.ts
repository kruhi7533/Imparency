import { NextRequest, NextResponse } from "next/server";
import { rejectPayment } from "@/lib/payment-service";
import { renderDecisionPage } from "@/lib/html-templates";

export async function GET(
  request: NextRequest,
  { params }: { params: { donationId: string; token: string } }
) {
  const { donationId, token } = params;

  try {
    const result = await rejectPayment(donationId, token);

    if (result.success) {
      return renderDecisionPage({
        status: "info",
        title: "Donation Cancelled",
        message: "Your donation request has been cancelled. Your checkout page has updated.",
      });
    } else {
      let errorMessage = "An error occurred while processing your donation cancellation.";
      if (result.reason === "ALREADY_PROCESSED") {
        errorMessage = "This donation has already been processed (either approved or cancelled).";
      } else if (result.reason === "INVALID_TOKEN") {
        errorMessage = "The security token provided is invalid.";
      } else if (result.reason === "DONATION_NOT_FOUND") {
        errorMessage = "We could not find the donation details matching this request.";
      }

      return renderDecisionPage({
        status: "error",
        title: "Cancellation Failed",
        message: errorMessage,
      });
    }
  } catch (error: any) {
    console.error("[reject route] Error rejecting donation:", error);
    return renderDecisionPage({
      status: "error",
      title: "Cancellation Error",
      message: "An internal server error occurred. Please try again.",
    });
  }
}
