import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { CAN_RESPOND } from "@/lib/renewal-requests";

export const dynamic = "force-dynamic";

/** GET /api/ngo/renewal-requests — funders' renewal / next-opportunity requests to this organisation. */
export async function GET() {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });

    const rows = await prisma.renewalRequest.findMany({
      where: { ngoId: actor.ngoId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: { report: { select: { id: true, title: true, periodStart: true, periodEnd: true } } },
    });
    const contracts = rows.length
      ? await prisma.contract.findMany({
          where: { id: { in: Array.from(new Set(rows.map((r) => r.contractId))) }, ngoId: actor.ngoId },
          select: { id: true, title: true, contractNumber: true, totalGrantAmount: true },
        })
      : [];
    const byId = new Map(contracts.map((c) => [c.id, c]));
    return NextResponse.json({
      canRespond: CAN_RESPOND.includes(actor.teamRole),
      requests: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        message: r.message,
        proposedAmount: r.proposedAmount?.toString() ?? null,
        ngoResponse: r.ngoResponse,
        createdAt: r.createdAt.toISOString(),
        respondedAt: r.respondedAt?.toISOString() ?? null,
        report: { id: r.report.id, title: r.report.title },
        contract: byId.has(r.contractId)
          ? { id: r.contractId, title: byId.get(r.contractId)!.title, contractNumber: byId.get(r.contractId)!.contractNumber }
          : { id: r.contractId, title: "Contract", contractNumber: "" },
      })),
    });
  } catch (error) {
    console.error("[api/ngo/renewal-requests] GET error:", error);
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
  }
}
