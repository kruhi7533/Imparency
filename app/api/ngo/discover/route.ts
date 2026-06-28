import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const causesParam = searchParams.get("causes") || "";
    const location = searchParams.get("location") || "";
    const sortBy = searchParams.get("sortBy") || "healthScore";
    const pageStr = searchParams.get("page") || "1";
    const limitStr = searchParams.get("limit") || "9";
    const minBudgetStr = searchParams.get("minBudget") || "";
    const minBudget = minBudgetStr ? parseInt(minBudgetStr, 10) : null;

    const page = parseInt(pageStr, 10);
    const limit = parseInt(limitStr, 10);
    const skip = (page - 1) * limit;

    // Build Prisma query clauses
    const whereClause: any = {
      verificationStatus: "VERIFIED",
      isDeleted: false,
    };

    if (minBudget && minBudget > 0) {
      whereClause.projects = {
        some: {
          status: "ACTIVE",
          isDeleted: false,
          targetAmount: {
            gte: minBudget,
          },
        },
      };
    }

    if (search) {
      whereClause.orgName = {
        contains: search,
        mode: "insensitive",
      };
    }

    if (location) {
      whereClause.address = {
        contains: location,
        mode: "insensitive",
      };
    }

    if (causesParam) {
      const causes = causesParam.split(",");
      whereClause.causeCategories = {
        hasSome: causes,
      };
    }

    // Build Sort options
    let orderByClause: any = {};
    if (sortBy === "healthScore") {
      orderByClause = { healthScore: "desc" };
    } else if (sortBy === "newest") {
      orderByClause = { createdAt: "desc" };
    } else {
      // Default fallback
      orderByClause = { healthScore: "desc" };
    }

    // Query NGOs
    const ngos = await prisma.nGOProfile.findMany({
      where: whereClause,
      take: limit,
      skip: skip,
      orderBy: orderByClause,
      select: {
        id: true,
        orgName: true,
        causeCategories: true,
        address: true,
        healthScore: true,
        description: true,
        createdAt: true,
        logo_url: true,
        cover_image_url: true,
        projects: {
          where: { isDeleted: false, status: "ACTIVE" },
          select: {
            id: true,
            raisedAmount: true,
            targetAmount: true,
          },
        },
        _count: {
          select: {
            projects: {
              where: { isDeleted: false, status: "ACTIVE" },
            },
            followers: true,
          },
        },
      },
    });

    // Post-process to calculate total raised across active projects
    const processedNGOs = ngos.map((ngo) => {
      const activeProjectsCount = ngo._count.projects;
      const totalRaised = ngo.projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0);
      const hasAffordableProject = minBudget
        ? ngo.projects.some(
            (p) => Number(p.targetAmount) - Number(p.raisedAmount) >= minBudget
          )
        : true;
      
      return {
        id: ngo.id,
        orgName: ngo.orgName,
        causeCategories: ngo.causeCategories,
        address: ngo.address,
        healthScore: ngo.healthScore !== null ? Number(ngo.healthScore) : null,
        description: ngo.description,
        activeProjectsCount,
        totalRaised,
        followersCount: ngo._count.followers,
        logo_url: ngo.logo_url,
        cover_image_url: ngo.cover_image_url,
        hasAffordableProject,
      };
    }).filter((ngo) => ngo.hasAffordableProject);

    // Remove hasAffordableProject from the final response
    const finalNGOs = processedNGOs.map(
      ({ hasAffordableProject, ...rest }) => rest
    );

    // NOTE: totalNGOs count is a DB-level approximation when minBudget
    // is active. Post-processing filter may reduce actual results.
    // For demo purposes this is acceptable. Production fix: raw SQL.
    const totalNGOs = await prisma.nGOProfile.count({
      where: whereClause,
    });

    return NextResponse.json({
      success: true,
      ngos: finalNGOs,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalNGOs / limit),
        totalNGOs,
      },
    });
  } catch (err: any) {
    console.error("Discovery API Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
