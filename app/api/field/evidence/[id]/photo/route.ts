import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { readPrivateFile } from "@/lib/storage";
import { isShareableWithDonor, resolveNgoActor } from "@/lib/field-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only way to read a field photo. Field photos can show beneficiaries, so:
 *  - the NGO's own team: always;
 *  - an admin: always (it is the review queue);
 *  - a donor: only if they fund this project through an ACTIVE/COMPLETED
 *    contract AND the evidence is approved and consented (isShareableWithDonor).
 * Everyone else gets 404, so the id's existence is not disclosed.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;
    const user = session.user as { id: string; role: string };

    const evidence = await prisma.fieldEvidence.findUnique({
      where: { id: params.id },
      select: {
        ngoId: true,
        projectId: true,
        photoKey: true,
        photoMime: true,
        status: true,
        containsPeople: true,
        feedback: { select: { consentToSharePhoto: true, withdrawnAt: true } },
      },
    });
    const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!evidence) return notFound;

    let allowed = false;
    if (user.role === "ADMIN") allowed = true;
    else if (user.role === "NGO") allowed = (await resolveNgoActor(user.id))?.ngoId === evidence.ngoId;
    else if (user.role === "DONOR") {
      const funds = await prisma.contract.findFirst({
        where: { donorId: user.id, projectId: evidence.projectId, status: { in: ["ACTIVE", "COMPLETED"] } },
        select: { id: true },
      });
      allowed = !!funds && isShareableWithDonor(evidence, evidence.feedback);
    }
    if (!allowed) return notFound;

    const bytes = await readPrivateFile(evidence.photoKey);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": evidence.photoMime,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[api/field/evidence/[id]/photo] GET error:", error);
    return NextResponse.json({ error: "Failed to load photo" }, { status: 500 });
  }
}
