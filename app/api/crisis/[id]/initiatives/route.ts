import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import { encryptBankAccountNumber } from "@/lib/crisis/bank-encryption";

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const rl = await checkRateLimit(request, "crisis/initiatives-create", 3, 86400);
    if (rl.isBlocked) return rl.response;

    const event = await prisma.crisisEvent.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });

    const formData = await request.formData();
    const organizerName = (formData.get("organizerName") as string | null)?.trim();
    const organizerType = (formData.get("organizerType") as string | null) || "INDIVIDUAL";
    const description = (formData.get("description") as string | null)?.trim();
    const location = (formData.get("location") as string | null)?.trim();
    const latitudeStr = formData.get("latitude") as string | null;
    const longitudeStr = formData.get("longitude") as string | null;
    const requiredFundsStr = formData.get("requiredFunds") as string | null;
    const bankAccountName = (formData.get("bankAccountName") as string | null)?.trim();
    const bankAccountNumber = (formData.get("bankAccountNumber") as string | null)?.trim();
    const bankIfsc = (formData.get("bankIfsc") as string | null)?.trim().toUpperCase();
    const bankProof = formData.get("bankProof") as File | null;
    const images = formData.getAll("images") as File[];
    const documents = formData.getAll("documents") as File[];

    if (!organizerName || !description || !location || !requiredFundsStr || !bankAccountName || !bankAccountNumber || !bankIfsc || !bankProof) {
      return NextResponse.json({ error: "Missing required initiative information" }, { status: 400 });
    }
    if (!["INDIVIDUAL", "INFORMAL_GROUP"].includes(organizerType)) {
      return NextResponse.json({ error: "Invalid organizerType" }, { status: 400 });
    }
    const requiredFunds = parseFloat(requiredFundsStr);
    if (isNaN(requiredFunds) || requiredFunds <= 0) {
      return NextResponse.json({ error: "Invalid requiredFunds" }, { status: 400 });
    }
    if (!IFSC_REGEX.test(bankIfsc)) {
      return NextResponse.json({ error: "Invalid IFSC code format" }, { status: 400 });
    }
    if (!/^\d{9,18}$/.test(bankAccountNumber)) {
      return NextResponse.json({ error: "Bank account number must be 9-18 digits" }, { status: 400 });
    }
    if (!bankProof.type.startsWith("image/") && bankProof.type !== "application/pdf") {
      return NextResponse.json({ error: "Bank proof must be an image or PDF" }, { status: 400 });
    }
    if (images.length > 6) {
      return NextResponse.json({ error: "A maximum of 6 images is allowed" }, { status: 400 });
    }
    if (documents.length > 4) {
      return NextResponse.json({ error: "A maximum of 4 documents is allowed" }, { status: 400 });
    }

    let bankAccountNumberEnc: string;
    try {
      bankAccountNumberEnc = encryptBankAccountNumber(bankAccountNumber);
    } catch (encErr) {
      console.error("Bank detail encryption failed:", encErr);
      return NextResponse.json({ error: "We couldn't securely process your bank details right now. Please try again." }, { status: 500 });
    }

    const bankProofUrl = await uploadFile(Buffer.from(await bankProof.arrayBuffer()), bankProof.name, "crisis/initiative-bank-proofs");

    const imageUrls: string[] = [];
    for (const file of images) {
      if (!(file instanceof File) || file.size === 0) continue;
      imageUrls.push(await uploadFile(Buffer.from(await file.arrayBuffer()), file.name, "crisis/initiative-images"));
    }
    const documentUrls: string[] = [];
    for (const file of documents) {
      if (!(file instanceof File) || file.size === 0) continue;
      documentUrls.push(await uploadFile(Buffer.from(await file.arrayBuffer()), file.name, "crisis/initiative-documents"));
    }

    const initiative = await prisma.reliefInitiative.create({
      data: {
        crisisEventId: event.id,
        submittedById: session.user.id,
        organizerName,
        organizerType,
        description,
        location,
        latitude: latitudeStr ? parseFloat(latitudeStr) : null,
        longitude: longitudeStr ? parseFloat(longitudeStr) : null,
        requiredFunds,
        bankAccountName,
        bankAccountNumberEnc,
        bankIfsc,
        bankProofUrl,
        images: imageUrls,
        documents: documentUrls,
      },
    });

    return NextResponse.json({ id: initiative.id, status: initiative.status }, { status: 201 });
  } catch (err: any) {
    console.error("Relief initiative creation error:", err);
    return NextResponse.json({ error: "We couldn't submit this initiative right now. Please try again." }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const includeAll = searchParams.get("all") === "1";

    let isAdmin = false;
    if (includeAll) {
      const { authorized, session } = await verifySessionRole("ADMIN");
      isAdmin = authorized && session?.user?.role === "ADMIN";
    }

    const initiatives = await prisma.reliefInitiative.findMany({
      where: { crisisEventId: params.id, ...(isAdmin ? {} : { status: "PUBLISHED" }) },
      select: {
        id: true, organizerName: true, organizerType: true, description: true, location: true,
        requiredFunds: true, raisedAmount: true, totalDonors: true, images: true, status: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      initiatives: initiatives.map((i) => ({ ...i, requiredFunds: Number(i.requiredFunds), raisedAmount: Number(i.raisedAmount) })),
    });
  } catch (err: any) {
    console.error("Relief initiative list error:", err);
    return NextResponse.json({ error: "Failed to load initiatives" }, { status: 500 });
  }
}
