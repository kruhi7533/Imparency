import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";

interface MilestoneInput {
  title: string;
  description: string;
  targetAmount: string;
  deadline: string;
  proofType: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id;

    // 1. Guard check: only NGO users can access
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const userId = session.user.id;

    // 2. Fetch NGO Profile to verify verificationStatus === VERIFIED and get ID
    const profile = await prisma.nGOProfile.findUnique({
      where: { userId },
      select: { id: true, verificationStatus: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "NGO Profile not found" }, { status: 404 });
    }

    if (profile.verificationStatus !== "VERIFIED") {
      return NextResponse.json({ error: "Only verified NGOs can edit projects" }, { status: 403 });
    }

    // 3. Fetch current project to check ownership and raisedAmount
    const project = await prisma.project.findUnique({
      where: { id: projectId, isDeleted: false },
      include: { milestones: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Ensure the project belongs to this NGO
    if (project.ngoId !== profile.id) {
      return NextResponse.json({ error: "Unauthorized access to project" }, { status: 403 });
    }

    const raisedAmount = Number(project.raisedAmount);
    const isLocked = raisedAmount > 0;

    // 4. Parse form data
    const formData = await request.formData();
    const title = formData.get("title") as string | null;
    const description = formData.get("description") as string | null;
    const problemStatement = formData.get("problemStatement") as string | null;
    const expectedOutcome = formData.get("expectedOutcome") as string | null;
    const location = formData.get("location") as string | null;
    const coverImageFile = formData.get("coverImage") as File | null;

    // Check required fields
    if (!title || !description || !location) {
      return NextResponse.json({ error: "Missing required project fields" }, { status: 400 });
    }

    // 5. Handle cover image upload if a new one is selected
    let coverImageUrl = project.coverImage;
    if (coverImageFile && coverImageFile instanceof File && coverImageFile.size > 0) {
      if (!coverImageFile.type.startsWith("image/")) {
        return NextResponse.json({ error: "Cover image must be a valid image file (JPEG, PNG, WebP)" }, { status: 400 });
      }

      if (coverImageFile.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: "Cover image size must not exceed 2MB" }, { status: 400 });
      }

      const arrayBuffer = await coverImageFile.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);
      coverImageUrl = await uploadFile(imageBuffer, coverImageFile.name, "covers");
    }

    // 6. Handle budget and milestones if the project is NOT locked
    let validatedMilestones: {
      title: string;
      description: string;
      targetAmount: number;
      deadline: Date;
      status: "PENDING";
      sequenceOrder: number;
    }[] = [];
    let targetAmount = Number(project.targetAmount);

    if (!isLocked) {
      const targetAmountStr = formData.get("targetAmount") as string | null;
      const milestonesStr = formData.get("milestones") as string | null;

      if (targetAmountStr && milestonesStr) {
        targetAmount = parseFloat(targetAmountStr);
        if (isNaN(targetAmount) || targetAmount <= 0) {
          return NextResponse.json({ error: "Invalid target amount" }, { status: 400 });
        }

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
        for (let i = 0; i < milestones.length; i++) {
          const m = milestones[i];
          if (!m.title || !m.description || !m.targetAmount || !m.deadline) {
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

        // Target match check
        if (Math.abs(milestonesTotal - targetAmount) > 0.01) {
          return NextResponse.json({
            error: `Milestone allocation mismatch. Total milestones sum (₹${milestonesTotal.toLocaleString()}) must match project target (₹${targetAmount.toLocaleString()}) exactly.`
          }, { status: 400 });
        }
      }
    }

    // 7. DB Transaction: save modifications
    await prisma.$transaction(async (tx) => {
      // Update Project model
      await tx.project.update({
        where: { id: projectId },
        data: {
          title: title.trim(),
          description: description.trim(),
          problem_statement: problemStatement ? problemStatement.trim() : null,
          expected_outcome: expectedOutcome ? expectedOutcome.trim() : null,
          location: location.trim(),
          coverImage: coverImageUrl,
          targetAmount: !isLocked ? targetAmount : undefined,
        },
      });

      // Update milestones if they were edited
      if (!isLocked && validatedMilestones.length > 0) {
        // Delete all old milestones
        await tx.milestone.deleteMany({
          where: { projectId },
        });

        // Create the new ones
        await tx.milestone.createMany({
          data: validatedMilestones.map((m) => ({
            projectId,
            title: m.title,
            description: m.description,
            targetAmount: m.targetAmount,
            deadline: m.deadline,
            sequenceOrder: m.sequenceOrder,
            status: m.status,
          })),
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Error editing project:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
