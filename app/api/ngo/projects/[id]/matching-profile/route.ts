import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { CAN_ASSIGN, resolveNgoActor } from "@/lib/field-evidence";
import { LEGACY_PROJECT_CADENCES, REPORTING_CADENCES } from "@/lib/requirements/form-options";
import { matchingReadiness } from "@/lib/project-readiness";

/**
 * PATCH /api/ngo/projects/[id]/matching-profile — the project's beneficiary
 * cohort and matching profile: expectedBeneficiaries, beneficiaryGroup,
 * durationMonths, primaryKPIs, reportingCadence.
 *
 * Separate from PATCH /api/ngo/projects/[id] on purpose: that route returns an
 * ACTIVE project to PENDING_APPROVAL on any edit, so filling in matching data
 * there would take a live, donation-taking project offline. These fields
 * describe who the project serves and how it reports — what matching compares
 * — not the donor-facing pitch the admin approved.
 *
 * Owners and team admins only. Role is not ownership: the project must belong
 * to the caller's NGO.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole("NGO");
  if (!authorized) return response;
  const actor = await resolveNgoActor(session.user.id);
  if (!actor || !CAN_ASSIGN.includes(actor.teamRole)) {
    return NextResponse.json({ error: "Only the organisation's owner or admins can edit the matching profile." }, { status: 403 });
  }
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, ngoId: true, isDeleted: true } });
  if (!project || project.isDeleted) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.ngoId !== actor.ngoId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const int = (v: unknown, min: number, max: number, label: string): number | null | string => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return `${label} must be a whole number between ${min} and ${max}.`;
    return n;
  };
  const beneficiaries = int(body?.expectedBeneficiaries, 1, 100_000_000, "Beneficiary cohort size");
  const duration = int(body?.durationMonths, 1, 120, "Duration");
  if (typeof beneficiaries === "string") return NextResponse.json({ error: beneficiaries }, { status: 400 });
  if (typeof duration === "string") return NextResponse.json({ error: duration }, { status: 400 });

  const group = typeof body?.beneficiaryGroup === "string" ? body.beneficiaryGroup.trim() : "";
  if (group.length > 200) return NextResponse.json({ error: "Describe the beneficiary group in 200 characters or fewer." }, { status: 400 });

  const rawKpis: unknown[] = Array.isArray(body?.primaryKPIs) ? body.primaryKPIs : [];
  const kpis = rawKpis.map((k) => (typeof k === "string" ? k.trim() : "")).filter(Boolean);
  if (kpis.length > 10 || kpis.some((k) => k.length > 120)) {
    return NextResponse.json({ error: "Up to 10 KPIs, each 120 characters or fewer." }, { status: 400 });
  }
  const cadence = typeof body?.reportingCadence === "string" && body.reportingCadence ? body.reportingCadence : null;
  if (cadence !== null && !REPORTING_CADENCES.includes(cadence) && !(cadence in LEGACY_PROJECT_CADENCES)) {
    return NextResponse.json({ error: `Reporting cadence must be one of: ${REPORTING_CADENCES.join(", ")}.` }, { status: 400 });
  }

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: {
      expectedBeneficiaries: beneficiaries,
      beneficiaryGroup: group || null,
      durationMonths: duration,
      primaryKPIs: kpis,
      reportingCadence: cadence,
    },
    select: {
      id: true,
      causeCategory: true,
      stateName: true,
      expectedBeneficiaries: true,
      beneficiaryGroup: true,
      durationMonths: true,
      primaryKPIs: true,
      reportingCadence: true,
    },
  });
  return NextResponse.json({ project: updated, readiness: matchingReadiness(updated) });
}
