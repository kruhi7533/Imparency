import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { sendProofQuestionEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const { milestoneId, question } = body;

    if (!milestoneId || !question?.trim()) {
      return NextResponse.json(
        { error: "Milestone ID and question are required" },
        { status: 400 }
      );
    }

    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        project: {
          include: {
            ngo: {
              include: {
                user: { select: { email: true } },
              },
            },
          },
        },
      },
    });

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const ngoEmail = milestone.project.ngo.user.email;
    const orgName = milestone.project.ngo.orgName;

    const result = await sendProofQuestionEmail(
      ngoEmail,
      orgName,
      milestone.title,
      question.trim()
    );

    if (!result.success) {
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Error in ask-ngo endpoint:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
