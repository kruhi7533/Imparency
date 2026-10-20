import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { EvidenceKind } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { previewOutcomeClaim, verifyCitationOwnership, type PreviewCitation } from "@/lib/outcome-cockpit";

/**
 * POST /api/ngo/outcome-claims/preview — what the reviewer's gate would say
 * about a claim before it is saved: triage verdict + findings, and how far the
 * cited evidence goes. Writes nothing. Same ownership rules as creating a claim.
 */
export const runtime = "nodejs";

const COLUMN: Record<string, "proofId" | "evidenceId" | "feedbackId" | undefined> = {
  MILESTONE_PROOF: "proofId",
  FIELD_PHOTO: "evidenceId",
  BENEFICIARY_FEEDBACK: "feedbackId",
};

export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole("NGO");
  if (!authorized) return response;
  const profile = await prisma.nGOProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!profile) return NextResponse.json({ error: "NGO profile not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const metric = await prisma.metricDefinition.findUnique({
    where: { code: String(body?.metricCode ?? "") },
    select: { code: true, unit: true, status: true, requiredEvidence: true },
  });
  if (!metric) return NextResponse.json({ error: "Choose a metric." }, { status: 400 });

  const value = String(body?.value ?? "").trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) {
    return NextResponse.json({ error: "Enter the value as a number with at most two decimal places." }, { status: 400 });
  }
  const periodStart = new Date(body?.periodStart ?? "");
  const periodEnd = new Date(body?.periodEnd ?? "");
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd < periodStart) {
    return NextResponse.json({ error: "Enter a valid reporting period." }, { status: 400 });
  }

  const citations: PreviewCitation[] = [];
  for (const c of Array.isArray(body?.citations) ? body.citations : []) {
    const column = COLUMN[c?.kind];
    const id = String(c?.id ?? "").trim();
    if (!column || !id) return NextResponse.json({ error: "Every citation needs a supported kind and an id." }, { status: 400 });
    citations.push({ kind: c.kind as EvidenceKind, [column]: id });
  }
  const ownership = await verifyCitationOwnership(citations, profile.id);
  if (ownership) return NextResponse.json({ error: ownership }, { status: 403 });

  return NextResponse.json(await previewOutcomeClaim({ metric, value, periodStart, periodEnd, citations }));
}
