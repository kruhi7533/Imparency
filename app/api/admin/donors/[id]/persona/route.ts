import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role, DonorPersona } from "@prisma/client";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/**
 * Admin sets a donor's persona.
 *
 * Existed nowhere before this: onboarding collects a persona for individuals,
 * but nothing let an admin correct or assign one — and persona is now load-
 * bearing, not descriptive. checkFunderEligibility (lib/matching/funder.ts)
 * requires CSR_OFFICER, FOUNDATION or GOVERNMENT before a donor can stand
 * behind a funding opportunity. Getting this wrong either blocks a real
 * institutional funder or, worse, is the only thing standing between an
 * individual account and being treated as one.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const { persona } = await request.json();
    if (!Object.values(DonorPersona).includes(persona)) {
      return NextResponse.json(
        { error: `persona must be one of ${Object.values(DonorPersona).join(", ")}` },
        { status: 400 }
      );
    }

    const donor = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true, donorPersona: true },
    });
    if (!donor || donor.role !== "DONOR") {
      return NextResponse.json({ error: "Donor not found" }, { status: 404 });
    }

    const oldPersona = donor.donorPersona;
    if (oldPersona === persona) {
      return NextResponse.json({ id: donor.id, persona });
    }

    await prisma.user.update({
      where: { id: donor.id },
      data: { donorPersona: persona },
    });

    await logAdminAction({
      adminId,
      action: "SETTING_UPDATED",
      entityType: "DONOR",
      entityId: donor.id,
      oldValue: { donorPersona: oldPersona },
      newValue: { donorPersona: persona },
      request,
    });

    return NextResponse.json({ id: donor.id, persona });
  } catch (err: any) {
    console.error("Failed to set donor persona:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
