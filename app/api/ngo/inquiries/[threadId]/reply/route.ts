import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: { threadId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "NGO" && session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only NGOs or Admins can reply" }, { status: 403 });
    }

    const { threadId } = params;
    const { body } = await request.json();

    if (!body || typeof body !== "string" || !body.trim()) {
      return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    }

    // Retrieve NGO Profile associated with this user
    let ngoId = (session.user as any).ngoProfileId;
    if (!ngoId) {
      const profile = await prisma.nGOProfile.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      });
      ngoId = profile?.id;
    }

    if (!ngoId && session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "NGO profile not found for user" }, { status: 404 });
    }

    // Find the thread
    const thread = await prisma.donorInquiry.findUnique({
      where: { id: threadId },
      include: { donor: true, ngo: true },
    });

    if (!thread) {
      return NextResponse.json({ error: "Inquiry thread not found" }, { status: 404 });
    }

    // Security check: Verify thread belongs to this NGO (unless Admin is overriding)
    if (session.user.role !== "ADMIN" && thread.ngoId !== ngoId) {
      return NextResponse.json({ error: "Forbidden: Thread belongs to another NGO" }, { status: 403 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Add message
      await tx.donorInquiryMessage.create({
        data: {
          threadId,
          senderId: session.user.id,
          senderRole: "NGO",
          body: body.trim(),
        },
      });

      // Update status
      return tx.donorInquiry.update({
        where: { id: threadId },
        data: {
          status: "RESPONDED",
          updatedAt: new Date(),
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
    });

    // Send notifications to the donor (async, non-blocking)
    try {
      if (thread && thread.ngo && thread.donor) {
        const { sendPushNotification } = await import("@/lib/notification");
        const { sendNGOReplyReceivedEmail } = await import("@/lib/email");
        
        const ngoName = thread.ngo.orgName || "NGO";
        
        await sendPushNotification(
          thread.donorId,
          `Reply from ${ngoName}`,
          `NGO "${ngoName}" replied to your inquiry: "${body.slice(0, 60)}${body.length > 60 ? "..." : ""}"`
        );

        if (thread.donor.email) {
          await sendNGOReplyReceivedEmail(
            thread.donor.email,
            thread.donor.name || "Donor",
            ngoName,
            body
          );
        }
      }
    } catch (notifErr) {
      console.error("Failed to send NGO reply notification:", notifErr);
    }

    return NextResponse.json({ inquiry: result });
  } catch (err: any) {
    console.error("NGO Reply Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
