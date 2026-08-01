import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const donorId = session.user.id;
    const ngoId = params.id;

    const inquiry = await prisma.donorInquiry.findUnique({
      where: {
        ngoId_donorId: {
          ngoId,
          donorId,
        },
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json({ inquiry });
  } catch (err: any) {
    console.error("GET Donor Inquiry Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const donorId = session.user.id;
    const ngoId = params.id;

    // Validate NGO profile
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      include: { user: true },
    });
    if (!ngo) {
      return NextResponse.json({ error: "NGO Profile not found" }, { status: 404 });
    }

    const { body } = await request.json();
    if (!body || typeof body !== "string" || !body.trim()) {
      return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    }

    // Upsert thread and create message in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const thread = await tx.donorInquiry.upsert({
        where: {
          ngoId_donorId: {
            ngoId,
            donorId,
          },
        },
        create: {
          ngoId,
          donorId,
          status: "OPEN",
        },
        update: {
          status: "OPEN",
          updatedAt: new Date(),
        },
      });

      await tx.donorInquiryMessage.create({
        data: {
          threadId: thread.id,
          senderId: donorId,
          senderRole: "DONOR",
          body: body.trim(),
        },
      });

      return tx.donorInquiry.findUnique({
        where: { id: thread.id },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
    });

    // Send notifications to the NGO owner (async, non-blocking)
    try {
      if (ngo && ngo.userId) {
        const { sendPushNotification } = await import("@/lib/notification");
        const { sendDonorInquiryReceivedEmail } = await import("@/lib/email");
        
        const donorName = session.user.name || "A donor";
        
        await sendPushNotification(
          ngo.userId,
          "New Inquiry Received",
          `${donorName} sent you a message: "${body.slice(0, 60)}${body.length > 60 ? "..." : ""}"`
        );

        if (ngo.user?.email) {
          await sendDonorInquiryReceivedEmail(
            ngo.user.email,
            donorName,
            ngo.orgName,
            body
          );
        }
      }
    } catch (notifErr) {
      console.error("Failed to send donor inquiry notification:", notifErr);
    }

    return NextResponse.json({ inquiry: result });
  } catch (err: any) {
    console.error("POST Donor Inquiry Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
