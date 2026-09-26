import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { createContract } from "@/lib/contract-service";

export async function GET(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const q = searchParams.get("q")?.trim() || "";

    const userRole = session.user.role;
    const userId = session.user.id;

    // Resolve query based on role
    const where: any = {};

    if (userRole === "DONOR") {
      where.donorId = userId;
    } else if (userRole === "NGO") {
      // Find NGO Profile for this user
      const ngoProfile = await prisma.nGOProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!ngoProfile) {
        return NextResponse.json({ contracts: [] });
      }
      where.ngoId = ngoProfile.id;
    } else if (userRole !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (status) {
      where.status = status;
    }

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { contractNumber: { contains: q, mode: "insensitive" } },
        { project: { title: { contains: q, mode: "insensitive" } } },
        { ngo: { orgName: { contains: q, mode: "insensitive" } } },
      ];
    }

    const contracts = await prisma.contract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        donor: { select: { id: true, name: true, email: true, companyName: true, isCorporate: true } },
        ngo: { select: { id: true, orgName: true, logo_url: true, panNumber: true } },
        project: { select: { id: true, title: true, location: true, coverImage: true } },
        milestones: { select: { id: true, title: true, allocatedAmount: true, status: true } },
      },
    });

    return NextResponse.json({ contracts });
  } catch (error: any) {
    console.error("[api/contracts] GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch contracts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const userRole = session.user.role;
    const userId = session.user.id;

    const body = await request.json();
    const {
      projectId,
      ngoId: inputNgoId,
      requirementId,
      title,
      description,
      totalGrantAmount,
      currency,
      startDate,
      endDate,
      csrScheduleViiCategory,
      reportingCadence,
      termsAndConditions,
      milestones,
    } = body;

    if (!projectId || !title || !totalGrantAmount || !termsAndConditions || !milestones || !milestones.length) {
      return NextResponse.json(
        { error: "Missing required fields: projectId, title, totalGrantAmount, termsAndConditions, milestones." },
        { status: 400 }
      );
    }

    // Verify Project exists and get its NGO
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { ngo: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project / Opportunity not found" }, { status: 404 });
    }

    let donorId: string;
    let ngoId: string = project.ngoId;

    if (userRole === "DONOR") {
      donorId = userId;
    } else if (userRole === "NGO") {
      // NGO proposing a contract to a donor
      const ngoProfile = await prisma.nGOProfile.findUnique({
        where: { userId },
      });
      if (!ngoProfile || ngoProfile.id !== project.ngoId) {
        return NextResponse.json({ error: "You can only create contracts for your own projects." }, { status: 403 });
      }
      if (!body.donorId) {
        return NextResponse.json({ error: "donorId is required when an NGO drafts a contract." }, { status: 400 });
      }
      donorId = body.donorId;
      ngoId = ngoProfile.id;
    } else {
      // Admin creating on behalf
      if (!body.donorId) {
        return NextResponse.json({ error: "donorId is required." }, { status: 400 });
      }
      donorId = body.donorId;
      ngoId = inputNgoId || project.ngoId;
    }

    const contract = await createContract({
      donorId,
      ngoId,
      projectId,
      requirementId,
      title,
      description,
      totalGrantAmount: Number(totalGrantAmount),
      currency: currency || "INR",
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      csrScheduleViiCategory,
      reportingCadence,
      termsAndConditions,
      milestones: milestones.map((m: any, idx: number) => ({
        title: m.title,
        description: m.description || "",
        allocatedAmount: Number(m.allocatedAmount),
        deliverables: m.deliverables || [],
        dueDate: m.dueDate ? new Date(m.dueDate) : null,
        projectMilestoneId: m.projectMilestoneId || null,
        orderIndex: m.orderIndex ?? idx,
      })),
      actorId: userId,
      actorRole: userRole,
    });

    return NextResponse.json({ contract }, { status: 201 });
  } catch (error: any) {
    console.error("[api/contracts] POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to create contract" }, { status: 400 });
  }
}
