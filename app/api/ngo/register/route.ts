import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";

export async function POST(request: Request) {
  try {
    // 1. Guard check: only NGO users can register
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const userId = session.user.id;

    // 2. Parse form data
    const formData = await request.formData();
    
    const orgName = formData.get("orgName") as string;
    const registrationNumber = formData.get("registrationNumber") as string;
    const panNumber = formData.get("panNumber") as string;
    const address = formData.get("address") as string;
    const website = formData.get("website") as string || null;
    const foundedYearStr = formData.get("foundedYear") as string;
    const description = formData.get("description") as string;
    const causeCategoriesStr = formData.get("causeCategories") as string;

    const regFile = formData.get("regFile") as File | null;
    const panFile = formData.get("panFile") as File | null;
    const taxFile = formData.get("taxFile") as File | null;

    // 3. Field validation
    if (!orgName || !registrationNumber || !panNumber || !address || !foundedYearStr || !description || !causeCategoriesStr) {
      return NextResponse.json({ error: "Missing mandatory registration fields" }, { status: 400 });
    }

    const foundedYear = parseInt(foundedYearStr, 10);
    if (isNaN(foundedYear)) {
      return NextResponse.json({ error: "Invalid founded year" }, { status: 400 });
    }

    let causeCategories: string[] = [];
    try {
      causeCategories = JSON.parse(causeCategoriesStr);
    } catch {
      return NextResponse.json({ error: "Invalid cause categories format" }, { status: 400 });
    }

    if (causeCategories.length === 0) {
      return NextResponse.json({ error: "Select at least one cause category" }, { status: 400 });
    }

    // 4. File validations (MIME & Size)
    const files = [
      { name: "Registration Certificate", file: regFile },
      { name: "NGO PAN Card Copy", file: panFile },
      { name: "80G Registration Copy", file: taxFile }
    ];

    for (const f of files) {
      if (!f.file) {
        return NextResponse.json({ error: `Missing required file: ${f.name}` }, { status: 400 });
      }
      
      // Strict MIME validation
      if (f.file.type !== "application/pdf") {
        return NextResponse.json({ error: `File '${f.name}' must be a PDF document` }, { status: 400 });
      }

      // Strict Size validation: 10MB limit
      if (f.file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: `File '${f.name}' exceeds the 10MB limit` }, { status: 400 });
      }
    }

    // 5. Check if registration number or PAN is already used by another NGO
    const existingNGO = await prisma.nGOProfile.findFirst({
      where: {
        userId: { not: userId },
        OR: [
          { registrationNumber },
          { panNumber }
        ]
      }
    });

    if (existingNGO) {
      return NextResponse.json({ error: "An NGO is already registered with this Registration Number or PAN" }, { status: 400 });
    }

    // 6. Upload files to Storage
    const uploadedUrls: string[] = [];
    for (const f of files) {
      const file = f.file!;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const url = await uploadFile(buffer, file.name, "documents");
      uploadedUrls.push(url);
    }

    // 7. Check if user already has an NGO Profile (resubmission flow)
    const currentProfile = await prisma.nGOProfile.findUnique({
      where: { userId }
    });

    let profile;
    if (currentProfile) {
      // Update existing profile (resubmit resets status to PENDING)
      profile = await prisma.nGOProfile.update({
        where: { id: currentProfile.id },
        data: {
          orgName,
          registrationNumber,
          panNumber,
          address,
          causeCategories,
          website,
          foundedYear,
          description,
          documents: uploadedUrls,
          verificationStatus: "PENDING",
          adminNote: null, // Reset previous notes
        }
      });
    } else {
      // Create new NGO Profile
      profile = await prisma.nGOProfile.create({
        data: {
          userId,
          orgName,
          registrationNumber,
          panNumber,
          address,
          causeCategories,
          website,
          foundedYear,
          description,
          documents: uploadedUrls,
          verificationStatus: "PENDING",
          healthScore: 100.00,
        }
      });
    }

    return NextResponse.json({ success: true, profileId: profile.id });
  } catch (err: any) {
    console.error("NGO Registration Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
