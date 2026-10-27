import type { ContractReportStatus, OutcomeClaimStatus } from "@prisma/client";
import { TeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { claimDisplay, type ClaimDisplay } from "@/lib/impact-quality";
import { triageClaim } from "@/lib/outcome-cockpit";

/**
 * Stored impact reports (NGO-017): an NGO's report to its funder for one
 * contract and one period.
 *
 *   DRAFT ──SUBMIT──▶ SUBMITTED ──PUBLISH (admin)──▶ PUBLISHED
 *     ▲                   │
 *     └──── RETURNED ◀────┘ RETURN (admin, note required)
 *
 * The report is built ONLY from outcome claims. At submission the APPROVED
 * claims in the period are pinned; nothing else ever becomes a figure. Every
 * read re-renders the pinned claims through `claimDisplay()` (the Week 8 read
 * contract, lib/impact-quality.ts) after re-triaging them, so a claim whose
 * evidence later fails — consent withdrawn, evidence rejected — reads
 * "unverified" even on a report that was already published. Never 0.
 */

export type ReportAction = "SUBMIT" | "PUBLISH" | "RETURN";

const TRANSITIONS: Record<ReportAction, { from: ContractReportStatus[]; to: ContractReportStatus; admin: boolean }> = {
  SUBMIT: { from: ["DRAFT", "RETURNED"], to: "SUBMITTED", admin: false },
  PUBLISH: { from: ["SUBMITTED"], to: "PUBLISHED", admin: true },
  RETURN: { from: ["SUBMITTED"], to: "RETURNED", admin: true },
};

export function isReportAction(v: unknown): v is ReportAction {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TRANSITIONS, v);
}

export function reportTransition(
  action: ReportAction,
  current: ContractReportStatus,
  actor: "NGO" | "ADMIN",
): { ok: true; to: ContractReportStatus } | { ok: false; status: number; error: string } {
  const t = TRANSITIONS[action];
  if (t.admin && actor !== "ADMIN") return { ok: false, status: 403, error: "Only an admin can publish or return a report." };
  if (!t.admin && actor !== "NGO") return { ok: false, status: 403, error: "Only the reporting organisation can submit." };
  if (!t.from.includes(current)) {
    return { ok: false, status: 409, error: `Cannot ${action.toLowerCase()} a report that is ${current}.` };
  }
  return { ok: true, to: t.to };
}

/** Draft fields are editable only before review. */
export function isReportEditable(status: ContractReportStatus): boolean {
  return status === "DRAFT" || status === "RETURNED";
}

/** Who in the NGO may create and submit a report to a funder. */
export const CAN_REPORT: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN];

/** Contracts a report can be written against: money is (or was) flowing. */
export const REPORTABLE_CONTRACT_STATUSES = ["ACTIVE", "COMPLETED"] as const;

export type ReportInput = { title: string; summary: string; periodStart: Date; periodEnd: Date };

export function parseReportInput(body: any, partial = false): { ok: true; value: Partial<ReportInput> } | { ok: false; error: string } {
  const out: Partial<ReportInput> = {};
  if (body?.title !== undefined || !partial) {
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!title) return { ok: false, error: "title is required" };
    out.title = title;
  }
  if (body?.summary !== undefined) {
    if (typeof body.summary !== "string") return { ok: false, error: "summary must be text" };
    out.summary = body.summary.trim().slice(0, 5000);
  }
  for (const k of ["periodStart", "periodEnd"] as const) {
    if (body?.[k] !== undefined || !partial) {
      const d = new Date(body?.[k]);
      if (!body?.[k] || Number.isNaN(d.getTime())) return { ok: false, error: `${k} must be a date` };
      out[k] = d;
    }
  }
  if (out.periodStart && out.periodEnd && out.periodStart >= out.periodEnd) {
    return { ok: false, error: "periodStart must be before periodEnd" };
  }
  return { ok: true, value: out };
}

/** Only APPROVED claims become report figures. Pure, for the pin at submission. */
export function reportableClaimIds(claims: { id: string; status: OutcomeClaimStatus }[]): string[] {
  return claims.filter((c) => c.status === "APPROVED").map((c) => c.id);
}

const CLAIM_SELECT = {
  id: true,
  metricCode: true,
  value: true,
  unit: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  metric: { select: { code: true, name: true, unit: true, status: true, requiredEvidence: true } },
  citations: { select: { id: true, kind: true, proofId: true, evidenceId: true, feedbackId: true } },
} as const;

/** Claims on the project whose period lies inside the report period. */
export async function claimsInPeriod(projectId: string, periodStart: Date, periodEnd: Date) {
  return prisma.outcomeClaim.findMany({
    where: {
      projectId,
      periodStart: { gte: periodStart },
      periodEnd: { lte: periodEnd },
      status: { in: ["SUBMITTED", "NEEDS_EVIDENCE", "APPROVED"] },
    },
    orderBy: [{ metricCode: "asc" }, { periodEnd: "asc" }],
    select: CLAIM_SELECT,
  });
}

export interface ReportFigure {
  claimId: string;
  metricCode: string;
  metricName: string;
  periodStart: string;
  periodEnd: string;
  display: ClaimDisplay;
}

async function toFigures(claims: Awaited<ReturnType<typeof claimsInPeriod>>): Promise<ReportFigure[]> {
  const triaged = await Promise.all(claims.map((c) => triageClaim(c as any)));
  return claims.map((c, i) => ({
    claimId: c.id,
    metricCode: c.metricCode,
    metricName: c.metric.name,
    periodStart: c.periodStart.toISOString(),
    periodEnd: c.periodEnd.toISOString(),
    display: claimDisplay({ status: c.status, value: c.value.toString(), unit: c.unit, triage: triaged[i] }),
  }));
}

/**
 * The figures a report shows. A submitted/published report renders its pinned
 * claims; a draft previews what would be pinned (approved claims) plus, for
 * the NGO only, the claims in the period still in review (which render
 * "unverified" and will NOT be included).
 */
export async function loadReportFigures(report: {
  status: ContractReportStatus;
  claimIds: string[];
  projectId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<{ figures: ReportFigure[]; pendingNotIncluded: ReportFigure[] }> {
  if (!isReportEditable(report.status)) {
    if (report.claimIds.length === 0) return { figures: [], pendingNotIncluded: [] };
    const pinned = await prisma.outcomeClaim.findMany({
      where: { id: { in: report.claimIds } },
      orderBy: [{ metricCode: "asc" }, { periodEnd: "asc" }],
      select: CLAIM_SELECT,
    });
    return { figures: await toFigures(pinned), pendingNotIncluded: [] };
  }
  const all = await claimsInPeriod(report.projectId, report.periodStart, report.periodEnd);
  const approved = all.filter((c) => c.status === "APPROVED");
  const pending = all.filter((c) => c.status !== "APPROVED");
  const [figures, pendingNotIncluded] = await Promise.all([toFigures(approved), toFigures(pending)]);
  return { figures, pendingNotIncluded };
}

export function serializeReport(r: any) {
  return {
    id: r.id,
    contractId: r.contractId,
    projectId: r.projectId,
    title: r.title,
    summary: r.summary,
    status: r.status,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    reviewNote: r.reviewNote ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
