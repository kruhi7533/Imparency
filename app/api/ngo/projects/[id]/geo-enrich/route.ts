import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { fetchGeoIntelligence } from "@/lib/geo-intelligence";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || session.user.role !== "NGO") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.id;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { ngo: true }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.ngo.userId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized to access this project" }, { status: 403 });
    }

    if (project.latitude === null || project.longitude === null) {
      return NextResponse.json({ error: "Project has no location set" }, { status: 400 });
    }

    // Cache check: 7 days
    if (project.geoFetchedAt && project.geoIntelligence) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      if (project.geoFetchedAt > sevenDaysAgo) {
        console.log(`[GEO ENRICH] Returning cached intelligence for project ${projectId}`);
        return NextResponse.json(project.geoIntelligence);
      }
    }

    console.log(`[GEO ENRICH] Fetching fresh intelligence for project ${projectId}`);
    
    const result = await fetchGeoIntelligence(
      project.latitude,
      project.longitude,
      project.districtName || "",
      project.stateName || ""
    );

    await prisma.project.update({
      where: { id: projectId },
      data: {
        geoIntelligence: result as any, // Cast to any to bypass Prisma JsonValue strict typing if needed
        geoFetchedAt: new Date()
      }
    });

    return NextResponse.json(result);

  } catch (error: any) {
    console.error("Error in geo enrichment:", error);
    return NextResponse.json(
      { error: "Failed to generate Geo Intelligence", details: error.message },
      { status: 500 }
    );
  }
}
