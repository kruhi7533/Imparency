import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { CAN_RESPOND, checkRenewalResponse } from "@/lib/renewal-requests";

/** PATCH { action: "ACCEPT" | "DECLINE", response } — the NGO answers a funder's request. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });

    const row = await prisma.renewalRequest.findUnique({ where: { id: params.id } });
    if (!row) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (row.ngoId !== actor.ngoId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!CAN_RESPOND.includes(actor.teamRole)) {
      return NextResponse.json({ error: "Only an owner or admin can answer a funder." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const check = checkRenewalResponse(row.status, body?.action, body?.response);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const { count } = await prisma.renewalRequest.updateMany({
      where: { id: row.id, status: "OPEN" },
      data: { status: check.to, ngoResponse: check.response, respondedById: session.user.id, respondedAt: new Date() },
    });
    if (count === 0) return NextResponse.json({ error: "Someone already answered this request." }, { status: 409 });

    try {
      await prisma.notification.create({
        data: {
          userId: row.donorId,
          type: "RENEWAL_ANSWERED",
          title: check.to === "ACCEPTED" ? "Your request was accepted" : "Your request was declined",
          body: `The organisation answered your ${row.kind === "RENEWAL" ? "renewal" : "next-opportunity"} request. Open the contract to read the response.`,
        },
      });
    } catch (err) {
      console.error("[ngo/renewal-requests] notify failed for", row.id, err);
    }
    return NextResponse.json({ ok: true, status: check.to });
  } catch (error) {
    console.error("[api/ngo/renewal-requests/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to answer request" }, { status: 500 });
  }
}
