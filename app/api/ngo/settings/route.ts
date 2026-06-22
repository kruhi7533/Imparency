import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";

export async function POST(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const userId = session.user.id;

    // Fetch existing NGO profile to verify it exists
    const ngoProfile = await prisma.nGOProfile.findUnique({
      where: { userId },
    });

    if (!ngoProfile) {
      return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const description = formData.get("description") as string | null;
    const website = formData.get("website") as string | null;
    const logoFile = formData.get("logo") as File | null;

    let logo_url = ngoProfile.logo_url;

    if (logoFile && logoFile.size > 0) {
      // Validate logo file is an image
      const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!validTypes.includes(logoFile.type)) {
        return NextResponse.json(
          { error: "Invalid image format. Allowed formats: JPEG, PNG, WEBP, GIF." },
          { status: 400 }
        );
      }

      // Validate logo file size (Max 5MB)
      if (logoFile.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "Logo image exceeds the 5MB limit." }, { status: 400 });
      }

      const arrayBuffer = await logoFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      logo_url = await uploadFile(buffer, logoFile.name, "logos");
    }

    const updatedProfile = await prisma.nGOProfile.update({
      where: { userId },
      data: {
        logo_url,
        ...(description !== null && { description }),
        ...(website !== null && { website: website || null }),
      },
    });

    return NextResponse.json({
      success: true,
      ngo: {
        logo_url: updatedProfile.logo_url,
        description: updatedProfile.description,
        website: updatedProfile.website,
      },
    });
  } catch (error: any) {
    console.error("Error in NGO Settings API:", error);
    return NextResponse.json({ error: error.message || "An unexpected error occurred" }, { status: 500 });
  }
}
