import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";
import { sendProjectPublishedEmail } from "@/lib/email";

interface MilestoneInput {
  title: string;
  description: string;
  targetAmount: string;
  deadline: string;
  proofType: string;
}

export async function POST(request: Request) {
  try {
    // 1. Guard check: only NGO users can access
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const userId = session.user.id;

    // 2. Query NGO Profile to verify verificationStatus === VERIFIED
    const profile = await prisma.nGOProfile.findUnique({
      where: { userId },
      select: { id: true, orgName: true, verificationStatus: true, user: { select: { email: true } } },
    });

    if (!profile) {
      return NextResponse.json({ error: "NGO Profile not found" }, { status: 404 });
    }

    if (profile.verificationStatus !== "VERIFIED") {
      return NextResponse.json({ error: "Only verified NGOs can launch new projects" }, { status: 403 });
    }

    // 3. Parse form data
    const formData = await request.formData();
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const causeCategory = formData.get("causeCategory") as string;
    const targetAmountStr = formData.get("targetAmount") as string;
    const location = formData.get("location") as string;
    const coverImage = formData.get("coverImage") as File | null;
    const milestonesStr = formData.get("milestones") as string;

    // 4. Basic field validations
    if (!title || !description || !causeCategory || !targetAmountStr || !location || !coverImage || !milestonesStr) {
      return NextResponse.json({ error: "Missing required project information" }, { status: 400 });
    }

    const targetAmount = parseFloat(targetAmountStr);
    if (isNaN(targetAmount) || targetAmount <= 0) {
      return NextResponse.json({ error: "Invalid target amount" }, { status: 400 });
    }

    // 5. Image file validations
    if (!coverImage.type.startsWith("image/")) {
      return NextResponse.json({ error: "Cover image must be a valid image file (JPEG, PNG, WebP)" }, { status: 400 });
    }

    if (coverImage.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Cover image size must not exceed 2MB" }, { status: 400 });
    }

    // 6. Milestones parsing & target sum validation
    let milestones: MilestoneInput[] = [];
    try {
      milestones = JSON.parse(milestonesStr);
    } catch {
      return NextResponse.json({ error: "Invalid milestones data format" }, { status: 400 });
    }

    if (milestones.length === 0) {
      return NextResponse.json({ error: "Project must contain at least one milestone" }, { status: 400 });
    }

    let milestonesTotal = 0;
    const validatedMilestones: {
      title: string;
      description: string;
      targetAmount: number;
      deadline: Date;
      status: "PENDING";
      sequenceOrder: number;
    }[] = [];

    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      if (!m.title || !m.description || !m.targetAmount || !m.deadline || !m.proofType) {
        return NextResponse.json({ error: `Missing details for Milestone ${i + 1}` }, { status: 400 });
      }

      const mTarget = parseFloat(m.targetAmount);
      if (isNaN(mTarget) || mTarget <= 0) {
        return NextResponse.json({ error: `Invalid target amount in Milestone ${i + 1}` }, { status: 400 });
      }

      const mDeadline = new Date(m.deadline);
      if (isNaN(mDeadline.getTime())) {
        return NextResponse.json({ error: `Invalid deadline date in Milestone ${i + 1}` }, { status: 400 });
      }

      milestonesTotal += mTarget;
      
      validatedMilestones.push({
        title: m.title.trim(),
        description: m.description.trim(),
        targetAmount: mTarget,
        deadline: mDeadline,
        status: "PENDING" as const,
        sequenceOrder: i + 1,
      });
    }

    // Strict allocation match check
    if (Math.abs(milestonesTotal - targetAmount) > 0.01) {
      return NextResponse.json({
        error: `Milestone allocation mismatch. Total milestones sum (₹${milestonesTotal.toLocaleString()}) must match project target (₹${targetAmount.toLocaleString()}) exactly.`
      }, { status: 400 });
    }

    // 7. Upload cover image
    const arrayBuffer = await coverImage.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const coverImageUrl = await uploadFile(imageBuffer, coverImage.name, "covers");

    // 8. DB Transaction: create Project & Milestones
    const newProject = await prisma.$transaction(async (tx) => {
      // Create Project
      const project = await tx.project.create({
        data: {
          ngoId: profile.id,
          title: title.trim(),
          description: description.trim(),
          causeCategory,
          targetAmount,
          status: "ACTIVE", // Automatically publish project as ACTIVE
          coverImage: coverImageUrl,
          location: location.trim(),
        }
      });

      // Create child milestones
      const milestoneData = validatedMilestones.map((m) => ({
        projectId: project.id,
        title: m.title,
        description: m.description,
        targetAmount: m.targetAmount,
        deadline: m.deadline,
        status: m.status,
        sequenceOrder: m.sequenceOrder,
      }));

      await tx.milestone.createMany({
        data: milestoneData
      });

      return project;
    });

    // 9. Send confirmation email to NGO owner
    await sendProjectPublishedEmail(profile.user.email, profile.orgName, newProject.title);

    return NextResponse.json({ success: true, projectId: newProject.id });
  } catch (err: any) {
    console.error("Project Publishing Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
