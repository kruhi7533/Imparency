import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { signContract } from "@/lib/contract-service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const contractId = params.id;
    const userId = session.user.id;
    const userRole = session.user.role;

    if (userRole !== "DONOR" && userRole !== "NGO") {
      return NextResponse.json({ error: "Only Donors or NGOs can sign contracts." }, { status: 403 });
    }

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: { ngo: true, donor: true },
    });

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Verify identity
    if (userRole === "DONOR" && contract.donorId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (userRole === "NGO" && contract.ngo.userId !== userId) {
      // Check if user is a team member with ADMIN or OWNER role
      const membership = await prisma.nGOTeamMember.findFirst({
        where: { userId, ngoId: contract.ngoId, role: { in: ["OWNER", "ADMIN"] } },
      });
      if (!membership) {
        return NextResponse.json({ error: "Only NGO owners or admins can sign agreements." }, { status: 403 });
      }
    }

    const body = await request.json();
    const { signerName, signerTitle, note } = body;

    if (!signerName || !signerTitle) {
      return NextResponse.json(
        { error: "Full Signer Name and Title/Designation are required to execute the agreement." },
        { status: 400 }
      );
    }

    const signerIp =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "127.0.0.1";

    const updated = await signContract({
      contractId,
      actorId: userId,
      actorRole: userRole as "DONOR" | "NGO",
      signerName,
      signerTitle,
      signerIp,
      note,
    });

    return NextResponse.json({ contract: updated });
  } catch (error: any) {
    console.error("[api/contracts/[id]/sign] POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to sign contract" }, { status: 400 });
  }
}
