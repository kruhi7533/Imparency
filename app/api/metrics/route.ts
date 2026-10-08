import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { UNIT_LABELS, EVIDENCE_KIND_LABELS } from "@/lib/metric-registry";

/**
 * GET /api/metrics — the Metric Registry read contract.
 *
 * This is the Week 8 deliverable the Dependencies sheet records as owed by the
 * admin track to the NGO track ("Producer: Intern 1 · Consumer: Intern 2 ·
 * Metric Registry · W8"), so the response shape is the interface and should
 * not be changed without telling that track.
 *
 * Defaults to ACTIVE only. A consumer building a metric picker wants the list
 * it may file claims against, and a DRAFT metric in that dropdown produces a
 * claim the API will reject — `?status=all` is there for the admin registry
 * screen, which needs to see drafts and deprecations too.
 *
 * Any signed-in user may read it. These are definitions, not data: there is
 * nothing tenant-scoped or personal in a metric, and every consumer (NGO
 * staff filing a claim, an admin reviewing one, a donor report rendering a
 * label) needs the same answer. No rate limiter for the same reason — it is a
 * small, cacheable, read-only list.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await verifySessionRole();
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const includeAll = status === "all";

  const metrics = await prisma.metricDefinition.findMany({
    where: includeAll ? {} : { status: "ACTIVE" },
    orderBy: [{ status: "asc" }, { code: "asc" }],
    select: {
      code: true,
      name: true,
      unit: true,
      definition: true,
      status: true,
      sdgGoals: true,
      irisCode: true,
      requiredEvidence: true,
      aggregatable: true,
      version: true,
    },
  });

  return NextResponse.json({
    metrics: metrics.map((m) => ({
      ...m,
      // Labels travel with the payload so a consumer does not have to import
      // from lib/ to render a unit, and cannot drift from this file's copy.
      unitLabel: UNIT_LABELS[m.unit],
      requiredEvidenceLabels: m.requiredEvidence.map((k) => EVIDENCE_KIND_LABELS[k]),
    })),
    // Stated so a consumer knows whether it is looking at the claimable set.
    filter: includeAll ? "all" : "ACTIVE",
  });
}
