import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { validateMetricDefinition, type MetricDefinitionInput } from "@/lib/metric-registry";
import type { EvidenceKind, MetricStatus, MetricUnit } from "@prisma/client";

/**
 * POST /api/admin/metrics — create a metric definition.
 *
 * Admin-only. The admin pages are gated in app/admin/layout.tsx, but the API is
 * directly reachable, so the route proves the role itself (CLAUDE.md §Tenancy).
 *
 * Validation goes through lib/metric-registry.ts, the same function the seed
 * tool uses. The registry's rules must hold wherever a metric enters the
 * system; a rule enforced only in the UI is not a rule.
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

/**
 * Membership checks use indexOf, not the `in` operator.
 *
 * `in` walks the prototype chain, so `{ unit: "toString" }` would pass a
 * naive guard. That exact two-line hazard was found and fixed in Week 7's
 * grievance routes (isGrievanceAction); it is not being reintroduced here.
 */
const isUnit = (v: unknown): v is MetricUnit => typeof v === "string" && UNITS.indexOf(v as MetricUnit) !== -1;
const isKind = (v: unknown): v is EvidenceKind => typeof v === "string" && KINDS.indexOf(v as EvidenceKind) !== -1;
const isStatus = (v: unknown): v is MetricStatus => typeof v === "string" && STATUSES.indexOf(v as MetricStatus) !== -1;

export async function POST(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isUnit(body?.unit)) {
    return NextResponse.json({ error: `unit must be one of: ${UNITS.join(", ")}` }, { status: 400 });
  }
  const status: MetricStatus = isStatus(body?.status) ? body.status : "DRAFT";

  const requiredEvidence: EvidenceKind[] = Array.isArray(body?.requiredEvidence)
    ? body.requiredEvidence.filter(isKind)
    : [];
  if (Array.isArray(body?.requiredEvidence) && requiredEvidence.length !== body.requiredEvidence.length) {
    return NextResponse.json({ error: `requiredEvidence may only contain: ${KINDS.join(", ")}` }, { status: 400 });
  }

  const sdgGoals: string[] = Array.isArray(body?.sdgGoals)
    ? body.sdgGoals.filter((g: unknown) => typeof g === "string")
    : [];

  const input: MetricDefinitionInput = {
    code: String(body?.code ?? "").trim(),
    name: String(body?.name ?? "").trim(),
    unit: body.unit,
    definition: String(body?.definition ?? "").trim(),
    status,
    sdgGoals,
    irisCode: body?.irisCode ? String(body.irisCode).trim() : null,
    requiredEvidence,
    aggregatable: body?.aggregatable !== false,
  };

  const errors = validateMetricDefinition(input);
  if (errors.length > 0) return NextResponse.json({ error: "Validation failed", errors }, { status: 400 });

  const existing = await prisma.metricDefinition.findUnique({ where: { code: input.code } });
  if (existing) {
    // Codes are the published contract; silently overwriting one would change
    // what every number already reported against it means.
    return NextResponse.json(
      { error: `Metric ${input.code} already exists. Edit it instead of recreating it.` },
      { status: 409 }
    );
  }

  const created = await prisma.metricDefinition.create({
    data: { ...input, createdById: auth.session.user.id },
    select: { code: true, status: true, unit: true, version: true },
  });

  // Ids and enum values only. The name and definition are free text and stay
  // out of a log that outlives PII retention on the main tables.
  await logAdminAction({
    adminId: auth.session.user.id,
    action: "METRIC_CREATED",
    entityType: "METRIC",
    entityId: created.code,
    newValue: { status: created.status, unit: created.unit, requiredEvidenceCount: requiredEvidence.length },
    request,
  });

  return NextResponse.json({ metric: created }, { status: 201 });
}
