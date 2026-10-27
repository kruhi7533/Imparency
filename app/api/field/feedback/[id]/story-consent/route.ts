import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";

const SCOPES = ["NONE", "DONOR_ONLY", "PUBLIC"] as const;

/**
 * POST { scope: "NONE" | "DONOR_ONLY" | "PUBLIC" } — record the beneficiary's
 * consent for their (anonymous) feedback to be quoted in impact stories.
 *
 * A separate purpose from consent to record. Any member of the owning NGO may
 * record it (field staff meet beneficiaries); another NGO gets 404. A withdrawn
 * consent cannot be re-granted here — re-consenting is a new capture.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });

    const body = await request.json().catch(() => null);
    const scope = body?.scope;
    if (!(SCOPES as readonly string[]).includes(scope)) {
      return NextResponse.json({ error: "scope must be NONE, DONOR_ONLY or PUBLIC" }, { status: 400 });
    }

    const fb = await prisma.beneficiaryFeedback.findUnique({ where: { id: params.id }, select: { id: true, ngoId: true, withdrawnAt: true, consentToRecord: true } });
    if (!fb || fb.ngoId !== actor.ngoId) return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
    if (fb.withdrawnAt) return NextResponse.json({ error: "Consent was withdrawn. Re-consenting is a new capture." }, { status: 409 });
    if (scope !== "NONE" && !fb.consentToRecord) {
      return NextResponse.json({ error: "This feedback was captured without consent to record; it cannot be quoted." }, { status: 409 });
    }

    const { count } = await prisma.beneficiaryFeedback.updateMany({
      where: { id: fb.id, ngoId: actor.ngoId, withdrawnAt: null },
      data: { storyConsent: scope, storyConsentAt: new Date() },
    });
    if (count === 0) return NextResponse.json({ error: "Consent was withdrawn meanwhile." }, { status: 409 });
    return NextResponse.json({ ok: true, storyConsent: scope });
  } catch (error) {
    console.error("[api/field/feedback/[id]/story-consent] POST error:", error);
    return NextResponse.json({ error: "Failed to record story consent" }, { status: 500 });
  }
}
