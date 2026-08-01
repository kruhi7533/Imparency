import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { generateUniqueCrisisSlug } from "@/lib/crisis/slug";
import { checkRateLimit } from "@/lib/rate-limiter";

const DISASTER_TYPES = [
  "FLOOD", "EARTHQUAKE", "CYCLONE", "WILDFIRE", "LANDSLIDE",
  "DROUGHT", "WAR_CONFLICT", "EPIDEMIC", "OTHER",
];
const SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

export async function POST(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

    const rl = await checkRateLimit(request, "admin/crisis-create", 20, 3600);
    if (rl.isBlocked) return rl.response;

    const formData = await request.formData();
    const title = (formData.get("title") as string | null)?.trim();
    const disasterType = formData.get("disasterType") as string | null;
    const description = (formData.get("description") as string | null)?.trim();
    const affectedLocation = (formData.get("affectedLocation") as string | null)?.trim();
    const country = ((formData.get("country") as string | null) || "India").trim();
    const stateName = (formData.get("stateName") as string | null)?.trim() || null;
    const city = (formData.get("city") as string | null)?.trim() || null;
    const severity = (formData.get("severity") as string | null) || "MODERATE";
    const startDateStr = formData.get("startDate") as string | null;
    const expectedEndDateStr = formData.get("expectedEndDate") as string | null;
    const latitudeStr = formData.get("latitude") as string | null;
    const longitudeStr = formData.get("longitude") as string | null;
    const coverImage = formData.get("coverImage") as File | null;
    const galleryFiles = formData.getAll("galleryImages") as File[];

    if (!title || !disasterType || !description || !affectedLocation || !startDateStr || !coverImage) {
      return NextResponse.json(
        { error: "title, disasterType, description, affectedLocation, startDate, and coverImage are required" },
        { status: 400 }
      );
    }

    if (!DISASTER_TYPES.includes(disasterType)) {
      return NextResponse.json({ error: "Invalid disasterType" }, { status: 400 });
    }
    if (!SEVERITIES.includes(severity)) {
      return NextResponse.json({ error: "Invalid severity" }, { status: 400 });
    }

    const startDate = new Date(startDateStr);
    if (isNaN(startDate.getTime())) {
      return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
    }
    let expectedEndDate: Date | null = null;
    if (expectedEndDateStr) {
      expectedEndDate = new Date(expectedEndDateStr);
      if (isNaN(expectedEndDate.getTime())) {
        return NextResponse.json({ error: "Invalid expectedEndDate" }, { status: 400 });
      }
      if (expectedEndDate < startDate) {
        return NextResponse.json({ error: "expectedEndDate cannot be before startDate" }, { status: 400 });
      }
    }

    if (!coverImage.type.startsWith("image/")) {
      return NextResponse.json({ error: "Cover image must be a valid image file" }, { status: 400 });
    }
    if (coverImage.size > 3 * 1024 * 1024) {
      return NextResponse.json({ error: "Cover image must not exceed 3MB" }, { status: 400 });
    }
    if (galleryFiles.length > 8) {
      return NextResponse.json({ error: "A maximum of 8 gallery images is allowed" }, { status: 400 });
    }

    const coverImageUrl = await uploadFile(
      Buffer.from(await coverImage.arrayBuffer()),
      coverImage.name,
      "crisis/covers"
    );

    const galleryImages: string[] = [];
    for (const file of galleryFiles) {
      if (!(file instanceof File) || file.size === 0) continue;
      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "All gallery files must be images" }, { status: 400 });
      }
      const url = await uploadFile(Buffer.from(await file.arrayBuffer()), file.name, "crisis/gallery");
      galleryImages.push(url);
    }

    const slug = await generateUniqueCrisisSlug(title);

    const event = await prisma.crisisEvent.create({
      data: {
        title,
        slug,
        disasterType: disasterType as any,
        description,
        affectedLocation,
        country,
        stateName,
        city,
        latitude: latitudeStr ? parseFloat(latitudeStr) : null,
        longitude: longitudeStr ? parseFloat(longitudeStr) : null,
        severity: severity as any,
        coverImage: coverImageUrl,
        galleryImages,
        startDate,
        expectedEndDate,
        createdById: session.user.id,
      },
    });

    await logAdminAction({
      adminId: session.user.id,
      action: "CRISIS_EVENT_CREATED",
      entityType: "CRISIS_EVENT",
      entityId: event.id,
      newValue: { title: event.title, disasterType: event.disasterType, severity: event.severity },
      request,
    });

    return NextResponse.json({ id: event.id, slug: event.slug, status: event.status }, { status: 201 });
  } catch (err: any) {
    console.error("Crisis Event creation error:", err);
    return NextResponse.json(
      { error: "We couldn't create this crisis event right now. Please try again." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { authorized, response } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const verificationStatus = searchParams.get("verificationStatus");

    const events = await prisma.crisisEvent.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(verificationStatus ? { verificationStatus: verificationStatus as any } : {}),
      },
      select: {
        id: true, title: true, slug: true, disasterType: true, severity: true,
        status: true, verificationStatus: true, isFeatured: true, isArchived: true,
        coverImage: true, totalRaised: true, totalDonors: true, totalCampaigns: true, totalNgos: true,
        startDate: true, expectedEndDate: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ events });
  } catch (err: any) {
    console.error("Crisis Event list error:", err);
    return NextResponse.json({ error: "Failed to load crisis events" }, { status: 500 });
  }
}
