import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { loadDonorProjectOutcomes, rollupByMetric } from "@/lib/outcome-cockpit";
import { FUNDING_CONTRACT_STATUSES, projectFunding } from "@/lib/project-funding";
import { loadDonorFeedbackForProjects } from "@/lib/feedback-summary";

/**
 * The donor's impact across everything they fund (roadmap row 12: "impact
 * dashboard; approved report").
 *
 * A project is in the donor's portfolio when they hold a signed (ACTIVE /
 * COMPLETED) contract on it, or made a SUCCESSful donation to it. Outcome
 * figures come only through `loadDonorProjectOutcomes`, which renders through
 * `claimDisplay()`: approved-and-still-backed shows the number, everything else
 * shows "unverified" — never 0, never omitted.
 *
 * Outcomes are PROJECT-level. They are not apportioned to the donor's share of
 * the funding, and the report says so: dividing "1,200 students reached" by a
 * funding ratio would invent a figure no one reported or reviewed.
 */

const MAX_PROJECTS = 50;
const dec = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v.toString());

export async function loadDonorImpact(donorId: string) {
  const [contracts, donations] = await Promise.all([
    prisma.contract.findMany({
      where: { donorId, status: { in: [...FUNDING_CONTRACT_STATUSES] } },
      select: {
        id: true,
        title: true,
        projectId: true,
        status: true,
        totalGrantAmount: true,
        payments: { select: { amount: true, status: true } },
      },
    }),
    prisma.donation.groupBy({
      by: ["projectId"],
      where: { donorId, status: "SUCCESS" },
      _sum: { amount: true },
    }),
  ]);

  const projectIds = Array.from(
    new Set([...contracts.map((c) => c.projectId), ...donations.map((d) => d.projectId)].filter((id): id is string => !!id))
  ).slice(0, MAX_PROJECTS);
  if (projectIds.length === 0) return { projects: [], portfolio: [], generatedAt: new Date().toISOString() };

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds }, isDeleted: false },
    select: {
      id: true,
      title: true,
      location: true,
      causeCategory: true,
      fundedAt: true,
      ngo: { select: { orgName: true } },
      milestones: { select: { status: true } },
    },
  });

  const [outcomes, feedback] = await Promise.all([
    Promise.all(projects.map((p) => loadDonorProjectOutcomes(p.id))),
    loadDonorFeedbackForProjects(projects.map((p) => p.id)),
  ]);

  const rows = projects.map((p, i) => {
    const mine = contracts.filter((c) => c.projectId === p.id);
    const myFunding = projectFunding(mine);
    const donated = donations.find((d) => d.projectId === p.id)?._sum.amount;
    return {
      projectId: p.id,
      title: p.title,
      ngoName: p.ngo.orgName,
      location: p.location,
      causeCategory: p.causeCategory,
      fundedAt: p.fundedAt?.toISOString() ?? null,
      contracts: mine.map((c) => ({ id: c.id, title: c.title, status: c.status })),
      /** The donor's own money only, as exact strings. */
      contribution: {
        contractCommitted: myFunding.committed,
        contractReconciled: myFunding.reconciled,
        donated: donated ? dec(donated).toFixed(2) : "0.00",
      },
      milestones: {
        total: p.milestones.length,
        verified: p.milestones.filter((m) => m.status === "VERIFIED" || m.status === "COMPLETED").length,
      },
      outcomes: outcomes[i].rows,
      /** Baseline → endline per metric, from verified figures only; else INSUFFICIENT_DATA. */
      changes: outcomes[i].changes ?? [],
      /** Aggregates only, consented only, suppressed below the cohort minimum. */
      beneficiaryFeedback: feedback[p.id] ?? { status: "INSUFFICIENT_DATA" as const, reason: "No consented beneficiary feedback yet." },
    };
  });

  const portfolio = rollupByMetric(
    rows.flatMap((r) =>
      r.outcomes.map((o) => ({ metricCode: o.metricCode, metricName: o.metricName, unit: o.unit, status: o.status, display: o.display, aggregatable: o.aggregatable, periodEnd: o.periodEnd }))
    )
  );

  return { projects: rows, portfolio, generatedAt: new Date().toISOString() };
}

export type DonorImpact = Awaited<ReturnType<typeof loadDonorImpact>>;

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * One row per outcome claim, then one row per baseline → endline change.
 *
 * A figure that is not verified is exported as the word "unverified" in the
 * value column — a blank or 0 in a spreadsheet would be summed as zero by
 * whoever opens it. A change that cannot be computed from verified figures is
 * exported as the literal "INSUFFICIENT_DATA" with its reason.
 */
export function impactReportCsv(report: DonorImpact): string {
  // row_type/note are appended (not inserted) so existing spreadsheets that
  // read columns by position keep working.
  const header = ["project", "organisation", "metric", "value", "unit", "period_start", "period_end", "status", "row_type", "note"];
  const lines = [header.join(",")];
  for (const p of report.projects) {
    for (const o of p.outcomes) {
      const verified = o.display.kind === "verified";
      lines.push(
        [
          p.title,
          p.ngoName,
          o.metricName,
          verified ? (o.display as { value: string }).value : "unverified",
          o.unit,
          o.periodStart.slice(0, 10),
          o.periodEnd.slice(0, 10),
          verified ? "verified" : "unverified",
          "figure",
          verified ? "" : (o.display as { reason: string }).reason,
        ]
          .map(csvCell)
          .join(",")
      );
    }
    for (const c of p.changes) {
      const computed = c.status === "COMPUTED";
      lines.push(
        [
          p.title,
          p.ngoName,
          c.metricName,
          computed ? c.change : "INSUFFICIENT_DATA",
          computed ? c.changeUnit : c.unit,
          computed ? c.baseline.periodStart.slice(0, 10) : "",
          computed ? c.endline.periodEnd.slice(0, 10) : "",
          computed ? "verified" : "INSUFFICIENT_DATA",
          "baseline_to_endline_change",
          computed ? `baseline ${c.baseline.value} -> endline ${c.endline.value}` : c.reason,
        ]
          .map(csvCell)
          .join(",")
      );
    }
  }
  return lines.join("\n") + "\n";
}
