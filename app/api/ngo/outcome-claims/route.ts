import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { acceptsNewClaims, claimRejectionReason } from "@/lib/metric-registry";
import type { EvidenceKind } from "@prisma/client";

/**
 * POST /api/ngo/outcome-claims — file an outcome claim as a DRAFT.
 *
 * **Boundary note.** The NGO-facing impact cockpit is Intern 2's Week 8
 * deliverable ("Outcome calculations; AI extraction with INSUFFICIENT_DATA;
 * impact cockpit"). This route is the admin track's half of the contract: the
 * claim has to be fileable for the approval workflow and the review queue to
 * be real, so the API is built here and the polished NGO UI is left to that
 * track — the same API-first split used for app/api/ngo/proposals in Week 5
 * and the grievance intake form in Week 7.
 *
 * Everything lands in DRAFT. Submitting is a separate PATCH, so filling a
 * number in is never the same keystroke as asserting it.
 */
export const runtime = "nodejs";

const KINDS: EvidenceKind[] = [
  "MILESTONE_PROOF", "FIELD_PHOTO", "BENEFICIARY_FEEDBACK",
  "ATTENDANCE_RECORD", "FINANCIAL_RECORD",
];
const isKind = (v: unknown): v is EvidenceKind =>
  typeof v === "string" && KINDS.indexOf(v as EvidenceKind) !== -1;

/** Which column a citation of this kind fills. */
const COLUMN_FOR_KIND: Record<EvidenceKind, "proofId" | "evidenceId" | "feedbackId" | null> = {
  MILESTONE_PROOF: "proofId",
  FIELD_PHOTO: "evidenceId",
  BENEFICIARY_FEEDBACK: "feedbackId",
  // No table backs these yet. A claim cannot cite one, and a metric requiring
  // one will be BLOCKED by the triage — the correct refusal, since the number
  // would be unprovable. See UNBACKED_EVIDENCE_KINDS in lib/metric-registry.ts.
  ATTENDANCE_RECORD: null,
  FINANCIAL_RECORD: null,
};

/** A decimal with at most two places, non-negative, within the column's range. */
function parseValue(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { error: "value is required." };
  }
  const s = String(raw).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) {
    return {
      error:
        "value must be a non-negative number with at most two decimal places (the column is NUMERIC(14,2)).",
    };
  }
  return { value: s };
}

export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole("NGO");
  if (!authorized) return response;

  const profile = await prisma.nGOProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });
  if (!profile) return NextResponse.json({ error: "NGO profile not found." }, { status: 404 });
  if (profile.verificationStatus !== "VERIFIED") {
    return NextResponse.json(
      { error: "Only verified organisations can report outcomes." },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // --- the metric has to exist and be open for claims ----------------------
  const metricCode = String(body?.metricCode ?? "").trim();
  const metric = await prisma.metricDefinition.findUnique({
    where: { code: metricCode },
    select: { code: true, unit: true, status: true },
  });
  if (!metric) {
    return NextResponse.json(
      { error: `Unknown metric "${metricCode}". Call GET /api/metrics for the claimable set.` },
      { status: 400 }
    );
  }
  if (!acceptsNewClaims(metric.status)) {
    return NextResponse.json({ error: claimRejectionReason(metric.status) }, { status: 409 });
  }

  // --- ownership: role is not ownership (CLAUDE.md §Tenancy) ---------------
  const projectId = String(body?.projectId ?? "").trim();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ngoId: true, isDeleted: true },
  });
  if (!project || project.isDeleted) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  if (project.ngoId !== profile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A milestone, if named, must belong to that same project — otherwise a
  // claim could be hung off another organisation's milestone.
  let milestoneId: string | null = null;
  if (body?.milestoneId) {
    const milestone = await prisma.milestone.findUnique({
      where: { id: String(body.milestoneId) },
      select: { id: true, projectId: true },
    });
    if (!milestone || milestone.projectId !== project.id) {
      return NextResponse.json(
        { error: "Milestone not found on this project." },
        { status: 400 }
      );
    }
    milestoneId = milestone.id;
  }

  const parsed = parseValue(body?.value);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const periodStart = new Date(body?.periodStart ?? "");
  const periodEnd = new Date(body?.periodEnd ?? "");
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return NextResponse.json({ error: "periodStart and periodEnd must be valid dates." }, { status: 400 });
  }
  if (periodEnd < periodStart) {
    return NextResponse.json({ error: "periodEnd cannot be before periodStart." }, { status: 400 });
  }

  const method = String(body?.method ?? "").trim();
  if (method.length < 10) {
    // "120" with no account of how it was counted is not reviewable, and it is
    // the reviewer's first question otherwise.
    return NextResponse.json(
      { error: "method must say how the number was arrived at (at least 10 characters)." },
      { status: 400 }
    );
  }

  // --- citations ------------------------------------------------------------
  const rawCitations = Array.isArray(body?.citations) ? body.citations : [];
  const citations: { kind: EvidenceKind; proofId?: string; evidenceId?: string; feedbackId?: string }[] = [];

  for (const c of rawCitations) {
    const kind: unknown = c?.kind;
    if (!isKind(kind)) {
      return NextResponse.json({ error: `citation kind must be one of: ${KINDS.join(", ")}` }, { status: 400 });
    }
    const column = COLUMN_FOR_KIND[kind];
    if (!column) {
      return NextResponse.json(
        { error: `${kind} cannot be cited yet — no evidence of that kind is stored by the platform.` },
        { status: 400 }
      );
    }
    const id = String(c?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "every citation needs an id." }, { status: 400 });
    citations.push({ kind, [column]: id } as (typeof citations)[number]);
  }

  // Cited evidence must belong to THIS organisation. Without this check an
  // organisation could cite a competitor's approved photo and inherit its
  // credibility — the tenancy trap, in the one place where a missing check
  // would also corrupt the impact numbers.
  const ownershipError = await verifyCitationOwnership(citations, profile.id);
  if (ownershipError) return NextResponse.json({ error: ownershipError }, { status: 403 });

  const claim = await prisma.outcomeClaim.create({
    data: {
      ngoId: profile.id,
      projectId: project.id,
      milestoneId,
      metricCode: metric.code,
      value: parsed.value,
      // Snapshotted from the registry now, so a later unit change cannot
      // restate this number.
      unit: metric.unit,
      periodStart,
      periodEnd,
      method,
      status: "DRAFT",
      citations: { create: citations },
    },
    select: { id: true, status: true, metricCode: true, value: true, unit: true },
  });

  return NextResponse.json({ claim }, { status: 201 });
}

/**
 * Every cited row must belong to the claiming organisation. Returns an error
 * message, or null when all citations check out.
 */
async function verifyCitationOwnership(
  citations: { proofId?: string; evidenceId?: string; feedbackId?: string }[],
  ngoId: string
): Promise<string | null> {
  const proofIds = citations.map((c) => c.proofId).filter((v): v is string => !!v);
  const evidenceIds = citations.map((c) => c.evidenceId).filter((v): v is string => !!v);
  const feedbackIds = citations.map((c) => c.feedbackId).filter((v): v is string => !!v);

  const [proofs, evidence, feedback] = await Promise.all([
    proofIds.length
      ? prisma.milestoneProof.findMany({
          where: { id: { in: proofIds } },
          select: { id: true, milestone: { select: { project: { select: { ngoId: true } } } } },
        })
      : Promise.resolve([]),
    evidenceIds.length
      ? prisma.fieldEvidence.findMany({ where: { id: { in: evidenceIds } }, select: { id: true, ngoId: true } })
      : Promise.resolve([]),
    feedbackIds.length
      ? prisma.beneficiaryFeedback.findMany({ where: { id: { in: feedbackIds } }, select: { id: true, ngoId: true } })
      : Promise.resolve([]),
  ]);

  if (proofs.length !== new Set(proofIds).size) return "A cited milestone proof does not exist.";
  if (evidence.length !== new Set(evidenceIds).size) return "A cited field photo does not exist.";
  if (feedback.length !== new Set(feedbackIds).size) return "A cited beneficiary record does not exist.";

  if (proofs.some((p) => p.milestone.project.ngoId !== ngoId)) {
    return "A cited milestone proof belongs to another organisation.";
  }
  if (evidence.some((e) => e.ngoId !== ngoId)) {
    return "A cited field photo belongs to another organisation.";
  }
  if (feedback.some((f) => f.ngoId !== ngoId)) {
    return "A cited beneficiary record belongs to another organisation.";
  }

  return null;
}
