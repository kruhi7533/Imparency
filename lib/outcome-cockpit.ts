import type { EvidenceKind, MetricUnit, OutcomeClaimStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { resolveCitations, evidenceAlreadyCounted } from "@/lib/outcome-evidence";
import { triageOutcomeClaim, evidenceUpperBound, type TriageResult } from "@/lib/outcome-triage";
import { ASSERTED_STATUSES, claimDisplay, fromMinorUnits, toMinorUnits, type ClaimDisplay } from "@/lib/impact-quality";

/**
 * The read side of outcome claims for the two parties who are not the admin:
 *
 *   NGO    the impact cockpit — what it has claimed, what the triage thinks of
 *          each claim, what evidence it can cite, and how far that evidence
 *          goes ("outcome calculation")
 *   DONOR  the figures on a funded project, through claimDisplay(): a number
 *          only when APPROVED and still backed by evidence, otherwise
 *          "unverified" — never 0, never omitted
 *
 * The triage is run here exactly as the admin approval route runs it
 * (resolveCitations + evidenceAlreadyCounted + triageOutcomeClaim), so the NGO
 * sees, before submitting, the same verdict the reviewer's gate will apply.
 */

export interface ClaimCitationRow {
  id: string;
  kind: EvidenceKind;
  proofId: string | null;
  evidenceId: string | null;
  feedbackId: string | null;
}

/** Triages one claim as the admin gate would. Null when the evidence could not be checked. */
export async function triageClaim(claim: {
  id: string;
  value: { toString(): string };
  unit: MetricUnit;
  periodStart: Date;
  periodEnd: Date;
  metricCode: string;
  metric: { code: string; unit: MetricUnit; status: any; requiredEvidence: EvidenceKind[] };
  citations: ClaimCitationRow[];
}): Promise<TriageResult | null> {
  try {
    const [resolved, alreadyCounted] = await Promise.all([
      resolveCitations(claim.citations),
      evidenceAlreadyCounted(claim.metricCode, claim.id),
    ]);
    return triageOutcomeClaim({
      claim: { id: claim.id, value: claim.value.toString(), unit: claim.unit, periodStart: claim.periodStart, periodEnd: claim.periodEnd },
      metric: claim.metric,
      citations: resolved,
      evidenceCitedByApprovedClaims: alreadyCounted,
    });
  } catch (err) {
    console.error("[outcome-cockpit] triage failed:", err);
    return null;
  }
}

// ─── Pure: per-metric roll-up ────────────────────────────────────────────────

export interface MetricRollup {
  metricCode: string;
  metricName: string;
  unit: MetricUnit;
  /** Sum of figures that are APPROVED and still backed — the only number a donor sees. */
  verifiedTotal: string;
  verifiedCount: number;
  inReviewCount: number;
  /** Approved but no longer backed, or triage could not run. */
  unverifiedApprovedCount: number;
  draftCount: number;
}

/**
 * Totals per metric — never across metrics: adding meals to people trained
 * gives a number in no unit (WEEK8-BLUEPRINT SPEC-4 decision). Sums are exact,
 * in minor units, never through a float.
 */
export function rollupByMetric(
  rows: Array<{ metricCode: string; metricName: string; unit: MetricUnit; status: OutcomeClaimStatus; display: ClaimDisplay }>
): MetricRollup[] {
  const by = new Map<string, MetricRollup & { minor: bigint }>();
  for (const r of rows) {
    const m =
      by.get(r.metricCode) ??
      { metricCode: r.metricCode, metricName: r.metricName, unit: r.unit, verifiedTotal: "0.00", verifiedCount: 0, inReviewCount: 0, unverifiedApprovedCount: 0, draftCount: 0, minor: BigInt(0) };
    if (r.display.kind === "verified") {
      m.minor += toMinorUnits(r.display.value);
      m.verifiedCount++;
    } else if (r.status === "APPROVED") m.unverifiedApprovedCount++;
    else if (r.status === "SUBMITTED" || r.status === "NEEDS_EVIDENCE") m.inReviewCount++;
    else if (r.status === "DRAFT") m.draftCount++;
    by.set(r.metricCode, m);
  }
  return Array.from(by.values())
    .map(({ minor, ...m }) => ({ ...m, verifiedTotal: fromMinorUnits(minor) }))
    .sort((a, b) => a.metricName.localeCompare(b.metricName));
}

// ─── NGO cockpit ─────────────────────────────────────────────────────────────

const decimalString = (v: { toString(): string }) => v.toString();

/** Everything /ngo/impact renders, for one organisation. */
export async function loadNgoImpactCockpit(ngoId: string) {
  const [projects, claims, metrics, proofs, fieldEvidence, feedback] = await Promise.all([
    prisma.project.findMany({
      where: { ngoId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, milestones: { orderBy: { sequenceOrder: "asc" }, select: { id: true, title: true } } },
    }),
    prisma.outcomeClaim.findMany({
      where: { ngoId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        milestoneId: true,
        metricCode: true,
        value: true,
        unit: true,
        periodStart: true,
        periodEnd: true,
        method: true,
        status: true,
        decisionNote: true,
        submittedAt: true,
        decidedAt: true,
        createdAt: true,
        metric: { select: { code: true, name: true, unit: true, status: true, requiredEvidence: true } },
        citations: { select: { id: true, kind: true, proofId: true, evidenceId: true, feedbackId: true } },
      },
    }),
    prisma.metricDefinition.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { code: true, name: true, unit: true, definition: true, requiredEvidence: true },
    }),
    prisma.milestoneProof.findMany({
      where: { milestone: { project: { ngoId, isDeleted: false } } },
      orderBy: { submittedAt: "desc" },
      take: 200,
      select: {
        id: true,
        description: true,
        submittedAt: true,
        milestone: { select: { title: true, projectId: true, reviews: { where: { action: "APPROVED" }, select: { id: true }, take: 1 } } },
      },
    }),
    prisma.fieldEvidence.findMany({
      where: { ngoId },
      orderBy: { capturedAt: "desc" },
      take: 300,
      select: { id: true, projectId: true, note: true, capturedAt: true, status: true },
    }),
    prisma.beneficiaryFeedback.findMany({
      where: { ngoId },
      orderBy: { capturedAt: "desc" },
      take: 300,
      select: { id: true, projectId: true, beneficiaryRef: true, capturedAt: true, consentToRecord: true, withdrawnAt: true, evidence: { select: { status: true } } },
    }),
  ]);

  const triaged = await Promise.all(claims.map((c) => triageClaim(c)));
  const claimRows = claims.map((c, i) => {
    const triage = triaged[i];
    const display = claimDisplay({ status: c.status, value: decimalString(c.value), unit: c.unit, triage });
    return {
      id: c.id,
      projectId: c.projectId,
      milestoneId: c.milestoneId,
      metricCode: c.metricCode,
      metricName: c.metric.name,
      value: decimalString(c.value),
      unit: c.unit,
      periodStart: c.periodStart.toISOString(),
      periodEnd: c.periodEnd.toISOString(),
      method: c.method,
      status: c.status,
      decisionNote: c.decisionNote,
      submittedAt: c.submittedAt?.toISOString() ?? null,
      decidedAt: c.decidedAt?.toISOString() ?? null,
      citationCount: c.citations.length,
      triage,
      display,
    };
  });

  // Evidence the organisation can cite, with the same "approved" meaning the triage uses.
  const evidence = [
    ...proofs.map((p) => ({
      kind: "MILESTONE_PROOF" as const,
      id: p.id,
      projectId: p.milestone.projectId,
      label: `Milestone proof — ${p.milestone.title}`,
      detail: p.description.slice(0, 140),
      date: p.submittedAt.toISOString(),
      approved: p.milestone.reviews.length > 0,
      note: p.milestone.reviews.length > 0 ? null : "Milestone not approved in proof review yet",
    })),
    ...fieldEvidence.map((e) => ({
      kind: "FIELD_PHOTO" as const,
      id: e.id,
      projectId: e.projectId,
      label: "Field photo",
      detail: (e.note ?? "").slice(0, 140),
      date: e.capturedAt.toISOString(),
      approved: e.status === "APPROVED",
      note: e.status === "APPROVED" ? null : `Field evidence is ${e.status.toLowerCase().replace(/_/g, " ")}`,
    })),
    ...feedback.map((f) => {
      const consented = f.consentToRecord && !f.withdrawnAt;
      const approved = f.evidence?.status === "APPROVED";
      return {
        kind: "BENEFICIARY_FEEDBACK" as const,
        id: f.id,
        projectId: f.projectId,
        label: `Beneficiary feedback${f.beneficiaryRef ? ` — ${f.beneficiaryRef}` : ""}`,
        detail: "",
        date: f.capturedAt.toISOString(),
        approved: approved && consented,
        note: !consented ? "No consent to record (or consent withdrawn)" : approved ? null : "Linked field capture not approved yet",
      };
    }),
  ];

  return {
    projects: projects.map((p) => ({ id: p.id, title: p.title, status: p.status, milestones: p.milestones })),
    metrics: metrics.map((m) => ({ ...m, requiredEvidence: m.requiredEvidence as EvidenceKind[] })),
    claims: claimRows,
    rollup: rollupByMetric(claimRows.map((c) => ({ metricCode: c.metricCode, metricName: c.metricName, unit: c.unit, status: c.status, display: c.display }))),
    evidence,
  };
}

export type NgoImpactCockpit = Awaited<ReturnType<typeof loadNgoImpactCockpit>>;

// ─── Citation ownership (shared with the create route) ───────────────────────

/**
 * Every cited row must belong to the claiming organisation. Returns an error
 * message, or null when all citations check out. Without this an organisation
 * could cite a competitor's approved photo and inherit its credibility.
 */
export async function verifyCitationOwnership(
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
    evidenceIds.length ? prisma.fieldEvidence.findMany({ where: { id: { in: evidenceIds } }, select: { id: true, ngoId: true } }) : Promise.resolve([]),
    feedbackIds.length ? prisma.beneficiaryFeedback.findMany({ where: { id: { in: feedbackIds } }, select: { id: true, ngoId: true } }) : Promise.resolve([]),
  ]);

  if (proofs.length !== new Set(proofIds).size) return "A cited milestone proof does not exist.";
  if (evidence.length !== new Set(evidenceIds).size) return "A cited field photo does not exist.";
  if (feedback.length !== new Set(feedbackIds).size) return "A cited beneficiary record does not exist.";
  if (proofs.some((p) => p.milestone.project.ngoId !== ngoId)) return "A cited milestone proof belongs to another organisation.";
  if (evidence.some((e) => e.ngoId !== ngoId)) return "A cited field photo belongs to another organisation.";
  if (feedback.some((f) => f.ngoId !== ngoId)) return "A cited beneficiary record belongs to another organisation.";
  return null;
}

// ─── Pre-submit check ("outcome calculation") ────────────────────────────────

export type PreviewCitation = { kind: EvidenceKind; proofId?: string; evidenceId?: string; feedbackId?: string };

/**
 * What the reviewer's gate would say about a claim that has not been saved:
 * the triage verdict and findings, and how far the cited evidence goes. For a
 * people-count metric backed by beneficiary feedback, each consented, approved
 * record supports one person — the one correspondence the data really holds
 * (evidenceUpperBound). For every other metric there is no honest formula, so
 * the bound is null and the UI says so rather than inventing one.
 */
export async function previewOutcomeClaim(args: {
  metric: { code: string; unit: MetricUnit; status: any; requiredEvidence: EvidenceKind[] };
  value: string;
  periodStart: Date;
  periodEnd: Date;
  citations: PreviewCitation[];
}) {
  const rows: ClaimCitationRow[] = args.citations.map((c, i) => ({
    id: `preview-${i}`,
    kind: c.kind,
    proofId: c.proofId ?? null,
    evidenceId: c.evidenceId ?? null,
    feedbackId: c.feedbackId ?? null,
  }));
  const [resolved, alreadyCounted] = await Promise.all([resolveCitations(rows), evidenceAlreadyCounted(args.metric.code, "__preview__")]);
  const triage = triageOutcomeClaim({
    claim: { id: "__preview__", value: args.value, unit: args.metric.unit, periodStart: args.periodStart, periodEnd: args.periodEnd },
    metric: args.metric,
    citations: resolved,
    evidenceCitedByApprovedClaims: alreadyCounted,
  });
  return { triage, upperBound: evidenceUpperBound(args.metric, resolved), approvedCitations: resolved.filter((c) => c.approved).length };
}

// ─── Donor: figures on a funded project ──────────────────────────────────────

/**
 * Outcome figures for a project the donor funds. Only asserted claims (in
 * review or approved) — drafts and withdrawn/rejected numbers were never
 * reported. Each goes through claimDisplay(), so an unbacked figure reads
 * "unverified" with the reason, never 0.
 */
export async function loadDonorProjectOutcomes(projectId: string) {
  const claims = await prisma.outcomeClaim.findMany({
    where: { projectId, status: { in: ASSERTED_STATUSES } },
    orderBy: [{ metricCode: "asc" }, { periodEnd: "desc" }],
    select: {
      id: true,
      metricCode: true,
      value: true,
      unit: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      metric: { select: { code: true, name: true, unit: true, status: true, requiredEvidence: true, definition: true } },
      citations: { select: { id: true, kind: true, proofId: true, evidenceId: true, feedbackId: true } },
    },
  });
  const triaged = await Promise.all(claims.map((c) => triageClaim({ ...c })));
  const rows = claims.map((c, i) => ({
    id: c.id,
    metricCode: c.metricCode,
    metricName: c.metric.name,
    definition: c.metric.definition,
    unit: c.unit,
    status: c.status,
    periodStart: c.periodStart.toISOString(),
    periodEnd: c.periodEnd.toISOString(),
    display: claimDisplay({ status: c.status, value: decimalString(c.value), unit: c.unit, triage: triaged[i] }),
  }));
  return { rows, rollup: rollupByMetric(rows.map((r) => ({ metricCode: r.metricCode, metricName: r.metricName, unit: r.unit, status: r.status, display: r.display }))) };
}
