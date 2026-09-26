import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { ContractStatus } from "@prisma/client";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const contractId = params.id;
    const userId = session.user.id;
    const userRole = session.user.role;

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        donor: {
          select: {
            id: true,
            name: true,
            email: true,
            companyName: true,
            isCorporate: true,
            gstNumber: true,
            donorPersona: true,
            city: true,
          },
        },
        ngo: {
          select: {
            id: true,
            orgName: true,
            panNumber: true,
            registrationNumber: true,
            logo_url: true,
            website: true,
            address: true,
            verificationStatus: true,
            userId: true,
          },
        },
        project: {
          select: {
            id: true,
            title: true,
            description: true,
            causeCategory: true,
            targetAmount: true,
            raisedAmount: true,
            location: true,
            coverImage: true,
          },
        },
        sponsorRequirement: {
          select: {
            id: true,
            fileName: true,
            extractedFields: true,
          },
        },
        milestones: {
          orderBy: { orderIndex: "asc" },
        },
        auditLogs: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Access control check
    if (userRole === "DONOR" && contract.donorId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (userRole === "NGO" && contract.ngo.userId !== userId) {
      // Check if user is a team member
      const membership = await prisma.nGOTeamMember.findFirst({
        where: { userId, ngoId: contract.ngoId },
      });
      if (!membership) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    return NextResponse.json({ contract });
  } catch (error: any) {
    console.error("[api/contracts/[id]] GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch contract" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const contractId = params.id;
    const userId = session.user.id;
    const userRole = session.user.role;

    const existing = await prisma.contract.findUnique({
      where: { id: contractId },
      include: { ngo: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Access check
    const isDonor = userRole === "DONOR" && existing.donorId === userId;
    const isNgo = userRole === "NGO" && existing.ngo.userId === userId;
    const isAdmin = userRole === "ADMIN";

    if (!isDonor && !isNgo && !isAdmin) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (existing.status !== ContractStatus.DRAFT && existing.status !== ContractStatus.UNDER_REVIEW) {
      return NextResponse.json(
        { error: `Cannot modify a contract in ${existing.status} status.` },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
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

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (totalGrantAmount !== undefined) updateData.totalGrantAmount = Number(totalGrantAmount);
    if (currency !== undefined) updateData.currency = currency;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (csrScheduleViiCategory !== undefined) updateData.csrScheduleViiCategory = csrScheduleViiCategory;
    if (reportingCadence !== undefined) updateData.reportingCadence = reportingCadence;
    if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions;

    const updated = await prisma.$transaction(async (tx) => {
      // If milestones are provided, update them
      if (Array.isArray(milestones) && milestones.length > 0) {
        await tx.contractMilestone.deleteMany({ where: { contractId } });
        await tx.contractMilestone.createMany({
          data: milestones.map((m: any, idx: number) => ({
            contractId,
            title: m.title,
            description: m.description || "",
            allocatedAmount: Number(m.allocatedAmount),
            deliverables: m.deliverables || [],
            dueDate: m.dueDate ? new Date(m.dueDate) : null,
            projectMilestoneId: m.projectMilestoneId || null,
            orderIndex: m.orderIndex ?? idx,
          })),
        });
      }

      await tx.contractAuditLog.create({
        data: {
          contractId,
          action: "TERMS_UPDATED",
          actorId: userId,
          actorRole: userRole,
          detail: "Contract terms and/or milestone schedules updated.",
        },
      });

      return await tx.contract.update({
        where: { id: contractId },
        data: updateData,
        include: {
          milestones: { orderBy: { orderIndex: "asc" } },
          auditLogs: { orderBy: { createdAt: "desc" } },
        },
      });
    });

    return NextResponse.json({ contract: updated });
  } catch (error: any) {
    console.error("[api/contracts/[id]] PATCH error:", error);
    return NextResponse.json({ error: error.message || "Failed to update contract" }, { status: 400 });
  }
}
