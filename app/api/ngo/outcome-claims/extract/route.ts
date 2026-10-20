import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import { extractOutcomes, type ExtractionSource } from "@/lib/gemini/extract-outcomes";

/**
 * POST /api/ngo/outcome-claims/extract — AI-suggested outcome figures for one
 * of the organisation's projects, read from its own proof descriptions and
 * field notes. Suggests only; writes nothing. Every metric comes back either
 * EXTRACTED (with a verbatim quote and the source it came from) or
 * INSUFFICIENT_DATA with the reason.
 *
 * Body: { projectId }.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const { isBlocked, response: limited } = await checkRateLimit(request, "outcome-extract", 10, 300);
  if (isBlocked && limited) return limited;
  const { authorized, response, session } = await verifySessionRole("NGO");
  if (!authorized) return response;

  const profile = await prisma.nGOProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });
  if (!profile) return NextResponse.json({ error: "NGO profile not found." }, { status: 404 });
  if (profile.verificationStatus !== "VERIFIED") {
    return NextResponse.json({ error: "Only verified organisations can report outcomes." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const project = await prisma.project.findUnique({
    where: { id: String(body?.projectId ?? "") },
    select: { id: true, ngoId: true, isDeleted: true },
  });
  if (!project || project.isDeleted) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.ngoId !== profile.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [metrics, proofs, captures] = await Promise.all([
    prisma.metricDefinition.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { code: true, name: true, unit: true, definition: true },
    }),
    prisma.milestoneProof.findMany({
      where: { milestone: { projectId: project.id } },
      orderBy: { submittedAt: "desc" },
      take: 25,
      select: {
        id: true,
        description: true,
        submittedAt: true,
        milestone: { select: { title: true, reviews: { where: { action: "APPROVED" }, select: { id: true }, take: 1 } } },
      },
    }),
    // Organisation-written capture notes only. Beneficiary feedback text is
    // never sent to the model (see lib/gemini/extract-outcomes.ts, Privacy).
    prisma.fieldEvidence.findMany({
      where: { projectId: project.id, ngoId: profile.id, note: { not: null } },
      orderBy: { capturedAt: "desc" },
      take: 25,
      select: { id: true, note: true, capturedAt: true, status: true },
    }),
  ]);

  const sources: ExtractionSource[] = [
    ...proofs.map((p) => ({
      id: "",
      kind: "MILESTONE_PROOF" as const,
      evidenceId: p.id,
      approved: p.milestone.reviews.length > 0,
      date: p.submittedAt.toISOString(),
      text: `Milestone "${p.milestone.title}": ${p.description}`,
    })),
    ...captures.map((c) => ({
      id: "",
      kind: "FIELD_PHOTO" as const,
      evidenceId: c.id,
      approved: c.status === "APPROVED",
      date: c.capturedAt.toISOString(),
      text: c.note ?? "",
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const result = await extractOutcomes({ metrics, sources });
  return NextResponse.json({
    usedModel: result.usedModel,
    suggestions: result.suggestions,
    sources: result.sources.map((s) => ({ id: s.id, kind: s.kind, evidenceId: s.evidenceId, approved: s.approved, date: s.date })),
  });
}
