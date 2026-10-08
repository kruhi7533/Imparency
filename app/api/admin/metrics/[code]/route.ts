import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction, type AdminAction } from "@/lib/admin-log";
import { validateMetricDefinition, type MetricDefinitionInput } from "@/lib/metric-registry";
import type { EvidenceKind, MetricStatus, MetricUnit } from "@prisma/client";

/**
 * PATCH /api/admin/metrics/[code] — edit a metric, or change its status.
 *
 * Two things this route refuses to do, both for the same reason — a metric
 * definition is governance, and an approved claim is a number already shown to
 * a funder:
 *
 *  - **No DELETE.** Deprecation is the only retirement. Deleting a metric
 *    would orphan or silently rewrite history (the FK is ON DELETE RESTRICT,
 *    so the database refuses too).
 *  - **No silent unit change on a metric with approved claims.** Approved
 *    claims snapshot their own unit, so they would keep their old meaning
 *    while the registry said something else. The edit is rejected and the
 *    admin is told to create a new code instead.
 */
export const runtime = "nodejs";

const UNITS: MetricUnit[] = [
  "COUNT_PEOPLE", "COUNT_ITEMS", "COUNT_EVENTS", "CURRENCY_INR",
  "PERCENTAGE", "HOURS", "KILOGRAMS", "LITRES", "AREA_SQM",
];
const KINDS: EvidenceKind[] = [
  "MILESTONE_PROOF", "FIELD_PHOTO", "BENEFICIARY_FEEDBACK",
  "ATTENDANCE_RECORD", "FINANCIAL_RECORD",
];
const STATUSES: MetricStatus[] = ["DRAFT", "ACTIVE", "DEPRECATED"];

// indexOf, not `in` — see the note in ../route.ts about the prototype-chain
// hazard fixed in Week 7.
const isUnit = (v: unknown): v is MetricUnit => typeof v === "string" && UNITS.indexOf(v as MetricUnit) !== -1;
const isKind = (v: unknown): v is EvidenceKind => typeof v === "string" && KINDS.indexOf(v as EvidenceKind) !== -1;
const isStatus = (v: unknown): v is MetricStatus => typeof v === "string" && STATUSES.indexOf(v as MetricStatus) !== -1;

/** The audit action that best describes what changed. */
function actionFor(from: MetricStatus, to: MetricStatus): AdminAction {
  if (from !== to && to === "ACTIVE") return "METRIC_ACTIVATED";
  if (from !== to && to === "DEPRECATED") return "METRIC_DEPRECATED";
  return "METRIC_UPDATED";
}

export async function PATCH(request: Request, { params }: { params: { code: string } }) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;

  const code = decodeURIComponent(params.code);
  const existing = await prisma.metricDefinition.findUnique({ where: { code } });
  if (!existing) return NextResponse.json({ error: "Metric not found." }, { status: 404 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body?.unit !== undefined && !isUnit(body.unit)) {
    return NextResponse.json({ error: `unit must be one of: ${UNITS.join(", ")}` }, { status: 400 });
  }
  if (body?.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(", ")}` }, { status: 400 });
  }

  let requiredEvidence = existing.requiredEvidence;
  if (body?.requiredEvidence !== undefined) {
    if (!Array.isArray(body.requiredEvidence)) {
      return NextResponse.json({ error: "requiredEvidence must be an array." }, { status: 400 });
    }
    const filtered = body.requiredEvidence.filter(isKind);
    if (filtered.length !== body.requiredEvidence.length) {
      return NextResponse.json({ error: `requiredEvidence may only contain: ${KINDS.join(", ")}` }, { status: 400 });
    }
    requiredEvidence = filtered;
  }

  const next: MetricDefinitionInput = {
    code: existing.code,
    name: body?.name !== undefined ? String(body.name).trim() : existing.name,
    unit: body?.unit !== undefined ? body.unit : existing.unit,
    definition: body?.definition !== undefined ? String(body.definition).trim() : existing.definition,
    status: body?.status !== undefined ? body.status : existing.status,
    sdgGoals: Array.isArray(body?.sdgGoals)
      ? body.sdgGoals.filter((g: unknown) => typeof g === "string")
      : existing.sdgGoals,
    irisCode:
      body?.irisCode !== undefined ? (body.irisCode ? String(body.irisCode).trim() : null) : existing.irisCode,
    requiredEvidence,
    aggregatable: body?.aggregatable !== undefined ? body.aggregatable !== false : existing.aggregatable,
  };

  const errors = validateMetricDefinition(next);
  if (errors.length > 0) return NextResponse.json({ error: "Validation failed", errors }, { status: 400 });

  // A unit change under approved claims would leave those numbers meaning one
  // thing and the registry saying another.
  if (next.unit !== existing.unit) {
    const approved = await prisma.outcomeClaim.count({ where: { metricCode: code, status: "APPROVED" } });
    if (approved > 0) {
      return NextResponse.json(
        {
          error:
            `${code} has ${approved} approved claim(s), so its unit cannot be changed. ` +
            `Create a new metric code instead — the existing numbers must keep the meaning they were approved with.`,
        },
        { status: 409 }
      );
    }
  }

  // Version tracks MEANING, not edits. A reworded definition or a changed unit
  // changes how a reported number should be read; fixing a typo in the name
  // does not.
  const meaningChanged = next.definition !== existing.definition || next.unit !== existing.unit;
  const version = meaningChanged ? existing.version + 1 : existing.version;

  const updated = await prisma.metricDefinition.update({
    where: { code },
    data: {
      name: next.name,
      unit: next.unit,
      definition: next.definition,
      status: next.status,
      sdgGoals: next.sdgGoals,
      irisCode: next.irisCode,
      requiredEvidence: next.requiredEvidence,
      aggregatable: next.aggregatable,
      version,
    },
    select: { code: true, status: true, unit: true, version: true },
  });

  // Enum values, counts and ids only — never the name or definition text.
  await logAdminAction({
    adminId: auth.session.user.id,
    action: actionFor(existing.status, updated.status),
    entityType: "METRIC",
    entityId: code,
    oldValue: { status: existing.status, unit: existing.unit, version: existing.version },
    newValue: { status: updated.status, unit: updated.unit, version: updated.version },
    request,
  });

  return NextResponse.json({ metric: updated });
}
