import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-log";
import { sendNGOSuspendedEmail, sendNGOReinstatedEmail } from "@/lib/email";

export const runtime = "nodejs";

// Actions: CLEAR | SUSPEND | ESCALATE
export async function POST(req: NextRequest) {
  const { authorized, response, session } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  try {
    return await handleRiskReview(req, session);
  } catch (err) {
    console.error("Risk review action failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

async function handleRiskReview(req: NextRequest, session: { user: { id: string } }) {
  const body = await req.json();
  const { reviewId, action, reviewNote } = body;

  if (!reviewId || !action) {
    return NextResponse.json({ error: "reviewId and action are required" }, { status: 400 });
  }

  if (!["CLEAR", "SUSPEND", "ESCALATE"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (!reviewNote?.trim()) {
    return NextResponse.json({ error: "A review note is required before taking action." }, { status: 400 });
  }

  const review = await prisma.riskReview.findUnique({
    where: { id: reviewId },
    include: {
      ngo: {
        select: {
          id: true,
          orgName: true,
          isSuspended: true,
          userId: true,
          user: { select: { email: true } },
        },
      },
    },
  });
  if (!review) {
    return NextResponse.json({ error: "Risk review not found" }, { status: 404 });
  }

  const adminId = session.user.id;
  const note = reviewNote.trim();
  const ngo = review.ngo;
  const wasSuspended = ngo.isSuspended;

  if (action === "SUSPEND") {
    // Admin manually suspends — human decision, not automated.
    // The reason is stored on the profile so the NGO can see WHY, and the NGO
    // is notified by email + in-app notification (accountability + fairness).
    await prisma.nGOProfile.update({
      where: { id: review.ngoId },
      data: {
        isSuspended: true,
        suspensionReason: note,
        suspendedAt: new Date(),
      },
    });

    await prisma.notification.create({
      data: {
        userId: ngo.userId,
        type: "NGO_SUSPENDED",
        title: "Your NGO has been suspended",
        body: `Following a risk review, ${ngo.orgName} has been suspended. Reason: ${note}. You can respond from your dashboard.`,
      },
    });

    try {
      await sendNGOSuspendedEmail(ngo.user.email, ngo.orgName, note);
    } catch (emailErr) {
      console.error("Failed to send suspension email:", emailErr);
    }

    await logAdminAction({
      adminId,
      action: "NGO_SUSPENDED",
      entityType: "NGO",
      entityId: review.ngoId,
      oldValue: { isSuspended: wasSuspended },
      newValue: { isSuspended: true },
      note,
      metadata: { riskReviewId: reviewId, riskLevel: review.riskLevel },
      request: req,
    });
  } else if (action === "CLEAR") {
    // Only lift the suspension when nothing ELSE is still open against this
    // NGO — clearing one review must not silently erase another suspension
    // ground (other open risk reviews or unresolved HIGH fraud alerts).
    const [otherOpenReviews, unresolvedHighAlerts] = await Promise.all([
      prisma.riskReview.count({
        where: { ngoId: review.ngoId, status: "OPEN", id: { not: reviewId } },
      }),
      prisma.fraudAlert.count({
        where: {
          entityId: review.ngoId,
          entityType: "NGO",
          resolved: false,
          severity: "HIGH",
        },
      }),
    ]);

    const safeToReinstate = otherOpenReviews === 0 && unresolvedHighAlerts === 0;

    if (wasSuspended && safeToReinstate) {
      await prisma.nGOProfile.update({
        where: { id: review.ngoId },
        data: { isSuspended: false, suspensionReason: null, suspendedAt: null },
      });

      await prisma.notification.create({
        data: {
          userId: ngo.userId,
          type: "NGO_REINSTATED",
          title: "Your NGO has been reinstated",
          body: `The suspension on ${ngo.orgName} has been lifted after review. You can receive donations and submit proofs again.`,
        },
      });

      try {
        await sendNGOReinstatedEmail(ngo.user.email, ngo.orgName);
      } catch (emailErr) {
        console.error("Failed to send reinstatement email:", emailErr);
      }
    }

    await logAdminAction({
      adminId,
      action: "RISK_REVIEW_CLEARED",
      entityType: "RISK_REVIEW",
      entityId: reviewId,
      oldValue: { isSuspended: wasSuspended },
      newValue: { isSuspended: wasSuspended && safeToReinstate ? false : wasSuspended },
      note,
      metadata: {
        ngoId: review.ngoId,
        reinstated: wasSuspended && safeToReinstate,
        blockedBy: safeToReinstate
          ? null
          : { otherOpenReviews, unresolvedHighAlerts },
      },
      request: req,
    });

    if (wasSuspended && !safeToReinstate) {
      // Clear the review below, but tell the admin why the NGO stays suspended.
      await prisma.riskReview.update({
        where: { id: reviewId },
        data: {
          status: "CLEARED",
          reviewedBy: adminId,
          reviewNote: note,
          resolvedAt: new Date(),
        },
      });
      return NextResponse.json({
        ok: true,
        status: "CLEARED",
        reinstated: false,
        warning: `Review cleared, but the NGO remains suspended: ${otherOpenReviews} other open risk review(s) and ${unresolvedHighAlerts} unresolved high-severity alert(s) still exist.`,
      });
    }
  } else {
    // ESCALATE — must be visible, not a silent note. The review stays OPEN
    // (it still needs a final CLEAR/SUSPEND decision) but is marked escalated
    // and the supervisor inbox (ADMIN_EMAIL) is notified.
    await logAdminAction({
      adminId,
      action: "RISK_REVIEW_ESCALATED",
      entityType: "RISK_REVIEW",
      entityId: reviewId,
      note,
      metadata: { ngoId: review.ngoId, riskLevel: review.riskLevel },
      request: req,
    });
  }

  const updated = await prisma.riskReview.update({
    where: { id: reviewId },
    data: {
      status: action === "CLEAR" ? "CLEARED" : action === "SUSPEND" ? "SUSPENDED" : "ESCALATED",
      reviewedBy: adminId,
      reviewNote: note,
      resolvedAt: ["CLEAR", "SUSPEND"].includes(action) ? new Date() : null,
    },
  });

  return NextResponse.json({ ok: true, status: updated.status });
}
