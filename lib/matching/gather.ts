import prisma from "@/lib/prisma";
import { deriveComplianceEvidence } from "@/lib/compliance-evidence";
import { deriveFcraStatus } from "@/lib/ngo-compliance";
import type { EligibilityInput } from "./types";

/**
 * The async half of the engine: turn a set of NGO ids into the flat, DB-free
 * structs `evaluateEligibility` consumes.
 *
 * Everything impure lives here — the queries, the Decimal conversion, and the
 * live FCRA derivation — so no rule ever touches Prisma. Same split as
 * `gatherNgoRisk` / `computeNgoRisk` in lib/risk-engine/ngo.ts.
 *
 * Batched deliberately: three queries for the whole pool rather than three per
 * organisation. A job over a few hundred NGOs otherwise becomes a few hundred
 * round trips to a serverless Postgres in another region.
 */
export async function gatherEligibilityInputs(
  ngoIds: string[],
  asOf: Date
): Promise<Map<string, EligibilityInput>> {
  const out = new Map<string, EligibilityInput>();
  if (ngoIds.length === 0) return out;

  const [ngos, fields, projects] = await Promise.all([
    prisma.nGOProfile.findMany({
      where: { id: { in: ngoIds } },
      select: {
        id: true,
        verificationStatus: true,
        isSuspended: true,
        causeCategories: true,
        foundedYear: true,
        healthScore: true,
        compliance: { select: { fcraStatus: true, fcraExpiryDate: true } },
      },
    }),
    prisma.extractedField.findMany({
      where: { ngoId: { in: ngoIds } },
      select: { ngoId: true, fieldKey: true, status: true },
    }),
    prisma.project.findMany({
      where: { ngoId: { in: ngoIds }, isDeleted: false },
      select: { id: true, ngoId: true, status: true, causeCategory: true, stateName: true },
    }),
  ]);

  const fieldsByNgo = new Map<string, { fieldKey: string; status: string }[]>();
  for (const f of fields) {
    const list = fieldsByNgo.get(f.ngoId) ?? [];
    list.push({ fieldKey: f.fieldKey, status: f.status });
    fieldsByNgo.set(f.ngoId, list);
  }

  const projectsByNgo = new Map<string, EligibilityInput["projects"]>();
  for (const p of projects) {
    const list = projectsByNgo.get(p.ngoId) ?? [];
    list.push({ id: p.id, status: p.status, causeCategory: p.causeCategory, stateName: p.stateName });
    projectsByNgo.set(p.ngoId, list);
  }

  for (const ngo of ngos) {
    // deriveComplianceEvidence is the source of truth, NOT NGOCompliance's
    // boolean flags: a flag can be set with no validated field behind it (the
    // bug revokeUnbackedFlags exists to retract), and one of those must never
    // win a grant. An organisation with no rows at all yields
    // `noExtraction: true`, which the rules render as UNKNOWN, not as clean.
    const evidence = deriveComplianceEvidence(fieldsByNgo.get(ngo.id) ?? []);

    // Derived live, because the stored column goes stale between cron runs.
    const fcraStatus =
      deriveFcraStatus(ngo.compliance?.fcraExpiryDate) ?? ngo.compliance?.fcraStatus ?? "NONE";

    out.set(ngo.id, {
      ngoId: ngo.id,
      verificationStatus: ngo.verificationStatus,
      isSuspended: ngo.isSuspended,
      causeCategories: ngo.causeCategories,
      foundedYear: ngo.foundedYear,
      // Decimal? -> number | null exactly once, here. Null means "never
      // calculated" and must survive as null all the way into the rule.
      healthScore: ngo.healthScore === null ? null : Number(ngo.healthScore),
      evidence,
      fcraStatus,
      projects: projectsByNgo.get(ngo.id) ?? [],
      asOf,
    });
  }

  return out;
}
