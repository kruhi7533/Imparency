import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";
import { sendProjectSubmittedEmail } from "@/lib/email";

interface MilestoneInput {
  title: string;
  description: string;
  targetAmount: string;
  deadline: string;
}

async function requireParticipant(crisisEventId: string, ngoId: string) {
  return prisma.crisisParticipant.findUnique({
    where: { crisisEventId_ngoId: { crisisEventId, ngoId } },
  });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const profile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true, orgName: true, verificationStatus: true, user: { select: { email: true } } },
    });
    if (!profile) return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
    if (profile.verificationStatus !== "VERIFIED") {
      return NextResponse.json({ error: "Only verified NGOs can run relief campaigns" }, { status: 403 });
    }

    const event = await prisma.crisisEvent.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });

    const participant = await requireParticipant(event.id, profile.id);
    if (!participant) {
      return NextResponse.json({ error: "Join this relief effort before creating or attaching a campaign" }, { status: 403 });
    }

    const contentType = request.headers.get("content-type") || "";

    // ── Attach an existing campaign this NGO already owns ──────────────────
    if (contentType.includes("application/json")) {
      const { mode, projectId } = await request.json();
      if (mode !== "attach" || !projectId) {
        return NextResponse.json({ error: "projectId is required to attach an existing campaign" }, { status: 400 });
      }

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project || project.ngoId !== profile.id) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      }
      if (project.crisisEventId) {
        return NextResponse.json({ error: "This campaign is already attached to a crisis" }, { status: 409 });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const p = await tx.project.update({ where: { id: projectId }, data: { crisisEventId: event.id } });
        await tx.crisisEvent.update({ where: { id: event.id }, data: { totalCampaigns: { increment: 1 } } });
        return p;
      });

      return NextResponse.json({ id: updated.id, crisisEventId: event.id, mode: "attach" }, { status: 200 });
    }

    // ── Create a brand-new campaign under the crisis ────────────────────────
    const formData = await request.formData();
    const title = (formData.get("title") as string | null)?.trim();
    const description = (formData.get("description") as string | null)?.trim();
    const causeCategory = (formData.get("causeCategory") as string | null) || "Disaster Relief";
    const targetAmountStr = formData.get("targetAmount") as string | null;
    const location = (formData.get("location") as string | null)?.trim();
    const coverImage = formData.get("coverImage") as File | null;
    const milestonesStr = formData.get("milestones") as string | null;

    if (!title || !description || !targetAmountStr || !location || !coverImage || !milestonesStr) {
      return NextResponse.json({ error: "Missing required campaign information" }, { status: 400 });
    }

    const targetAmount = parseFloat(targetAmountStr);
    if (isNaN(targetAmount) || targetAmount <= 0) {
      return NextResponse.json({ error: "Invalid target amount" }, { status: 400 });
    }
    if (!coverImage.type.startsWith("image/")) {
      return NextResponse.json({ error: "Cover image must be a valid image file" }, { status: 400 });
    }
    if (coverImage.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Cover image must not exceed 2MB" }, { status: 400 });
    }

    let milestones: MilestoneInput[] = [];
    try {
      milestones = JSON.parse(milestonesStr);
    } catch {
      return NextResponse.json({ error: "Invalid milestones data format" }, { status: 400 });
    }
    if (milestones.length === 0) {
      return NextResponse.json({ error: "Campaign must contain at least one milestone" }, { status: 400 });
    }

    let milestonesTotal = 0;
    const validated: { title: string; description: string; targetAmount: number; deadline: Date; sequenceOrder: number }[] = [];
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      const mTarget = parseFloat(m.targetAmount);
      const mDeadline = new Date(m.deadline);
      if (!m.title || !m.description || isNaN(mTarget) || mTarget <= 0 || isNaN(mDeadline.getTime())) {
        return NextResponse.json({ error: `Invalid details for milestone ${i + 1}` }, { status: 400 });
      }
      milestonesTotal += mTarget;
      validated.push({ title: m.title.trim(), description: m.description.trim(), targetAmount: mTarget, deadline: mDeadline, sequenceOrder: i + 1 });
    }
    if (Math.abs(milestonesTotal - targetAmount) > 0.01) {
      return NextResponse.json({ error: "Milestone allocation must sum exactly to the campaign target" }, { status: 400 });
    }

    const coverImageUrl = await uploadFile(Buffer.from(await coverImage.arrayBuffer()), coverImage.name, "crisis/campaigns");

    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          ngoId: profile.id,
          crisisEventId: event.id,
          title,
          description,
          causeCategory,
          targetAmount,
          status: "PENDING_APPROVAL",
          coverImage: coverImageUrl,
          location,
        },
      });
      await tx.milestone.createMany({
        data: validated.map((m) => ({ projectId: p.id, ...m, status: "PENDING" as const })),
      });
      await tx.crisisEvent.update({ where: { id: event.id }, data: { totalCampaigns: { increment: 1 } } });
      return p;
    });

    await sendProjectSubmittedEmail(profile.user.email, profile.orgName, project.title);

    return NextResponse.json({ id: project.id, status: "PENDING_APPROVAL", mode: "create" }, { status: 201 });
  } catch (err: any) {
    console.error("Crisis campaign create/attach error:", err);
    return NextResponse.json({ error: "We couldn't process this campaign right now. Please try again." }, { status: 500 });
  }
}
