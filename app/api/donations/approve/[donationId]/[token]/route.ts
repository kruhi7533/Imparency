import { NextRequest, NextResponse } from "next/server";
import { approvePayment } from "@/lib/payment-service";
import { renderDecisionPage } from "@/lib/html-templates";

export async function GET(
  request: NextRequest,
  { params }: { params: { donationId: string; token: string } }
) {
  const { donationId, token } = params;

  try {
    const result = await approvePayment(donationId, token);

    if (result.success) {
      return renderDecisionPage({
        status: "success",
        title: "Donation Approved",
        message: "Thank you! Your donation has been approved and processed. Your checkout page has updated.",
      });
    } else {
      let errorMessage = "An error occurred while processing your donation approval.";
      if (result.reason === "ALREADY_PROCESSED") {
        errorMessage = "This donation has already been processed (either approved or cancelled).";
      } else if (result.reason === "TOKEN_EXPIRED") {
        errorMessage = "This approval link has expired. Please initiate a new donation.";
      } else if (result.reason === "INVALID_TOKEN") {
        errorMessage = "The security token provided is invalid.";
      } else if (result.reason === "DONATION_NOT_FOUND") {
        errorMessage = "We could not find the donation details matching this request.";
      }

      return renderDecisionPage({
        status: "error",
        title: "Approval Failed",
        message: errorMessage,
      });
    }
  } catch (error: any) {
    console.error("[approve route] Error approving donation:", error);
    return renderDecisionPage({
      status: "error",
      title: "Approval Error",
      message: "An internal server error occurred. Please try again.",
    });
  }
}
