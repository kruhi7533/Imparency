import prisma from "@/lib/prisma";

/**
 * Maps validated extraction evidence onto the NGOCompliance.*Verified flags.
 *
 * Why this exists: app/api/admin/verify-ngo/route.ts used to set
 * panVerified / registrationVerified / eightyGVerified to true unconditionally
 * on APPROVE, and a12Verified on the mere existence of a document URL. Since
 * NGOProfile.documents is an untyped String[], the route could not know whether
 * an 80G certificate had even been uploaded — yet it wrote "80G certificate
 * verified." into ComplianceAuditLog and 20 points into the donor-facing
 * compliance score (COMPLIANCE_WEIGHTS in lib/ngo-compliance.ts).
 *
 * Each flag now requires a specific field an admin actually validated.
 *
 * Deliberately imports only prisma — verify-ngo must not pull in the Gemini SDK
 * just to read evidence.
 */

/** Which validated field earns which compliance flag. */
export const FLAG_EVIDENCE_FIELD = {
  panVerified: "panNumber",
  registrationVerified: "registrationNumber",
  a12Verified: "a12Number",
  eightyGVerified: "eightyGNumber",
} as const;

export type ComplianceFlag = keyof typeof FLAG_EVIDENCE_FIELD;

export interface ComplianceEvidence {
  /** Flags that have a VALIDATED field behind them. */
  earned: Record<ComplianceFlag, boolean>;
  /** Field keys still sitting in NEEDS_REVIEW. */
  outstanding: string[];
  /** True when extraction has never been run for this NGO. */
  noExtraction: boolean;
}

const ALL_FLAGS = Object.keys(FLAG_EVIDENCE_FIELD) as ComplianceFlag[];

/**
 * Pure: given the NGO's extracted fields, decide which flags are earned.
 * Exported separately from the query so it can be unit-tested without a DB.
 */
export function deriveComplianceEvidence(
  fields: { fieldKey: string; status: string }[]
): ComplianceEvidence {
  const statusByKey = new Map(fields.map((f) => [f.fieldKey, f.status]));

  const earned = {} as Record<ComplianceFlag, boolean>;
  for (const flag of ALL_FLAGS) {
    earned[flag] = statusByKey.get(FLAG_EVIDENCE_FIELD[flag]) === "VALIDATED";
  }

  const outstanding = fields
    .filter((f) => f.status === "NEEDS_REVIEW")
    .map((f) => f.fieldKey);

  return { earned, outstanding, noExtraction: fields.length === 0 };
}

/** Loads the NGO's extracted fields and derives its compliance evidence. */
export async function getComplianceEvidence(ngoId: string): Promise<ComplianceEvidence> {
  const fields = await prisma.extractedField.findMany({
    where: { ngoId },
    select: { fieldKey: true, status: true },
  });
  return deriveComplianceEvidence(fields);
}

/**
 * Compliance flags that are set on an NGO but have no validated field behind
 * them — a claim the platform is making publicly that it cannot support.
 *
 * These exist for a historical reason, not a hypothetical one: approval used to
 * set panVerified / registrationVerified / eightyGVerified unconditionally, and
 * 12A on the mere existence of a document URL. Those rows are still in the
 * database, still rendering "PAN verified" badges on public profiles, and still
 * contributing to the donor-facing compliance score. Two NGOs were carrying six
 * such flags between them against two validated fields platform-wide.
 */
export async function findUnbackedFlags(ngoId: string): Promise<ComplianceFlag[]> {
  const compliance = await prisma.nGOCompliance.findUnique({
    where: { ngoId },
    select: { panVerified: true, registrationVerified: true, a12Verified: true, eightyGVerified: true },
  });
  if (!compliance) return [];

  const evidence = await getComplianceEvidence(ngoId);
  return (Object.keys(FLAG_EVIDENCE_FIELD) as ComplianceFlag[]).filter(
    (flag) => compliance[flag] && !evidence.earned[flag]
  );
}

/**
 * Revoke one NGO's unbacked flags.
 *
 * This is not an action against the organisation — it is the platform retracting
 * a statement it should not have made. The flag is not deleted from history and
 * nothing about the NGO changes: the moment an admin validates the field behind
 * it, the flag is earned again through the normal path.
 *
 * Returns what it revoked so a caller can report it rather than doing it
 * silently — a compliance badge disappearing from a public profile is something
 * an admin should be able to see happened, and why.
 */
export async function revokeUnbackedFlags(ngoId: string): Promise<ComplianceFlag[]> {
  const unbacked = await findUnbackedFlags(ngoId);
  if (unbacked.length === 0) return [];

  const compliance = await prisma.nGOCompliance.findUnique({
    where: { ngoId },
    select: { id: true },
  });
  if (!compliance) return [];

  await prisma.nGOCompliance.update({
    where: { id: compliance.id },
    data: Object.fromEntries(unbacked.map((f) => [f, false])),
  });

  const { logComplianceEvent } = await import("@/lib/ngo-compliance");
  await logComplianceEvent(
    compliance.id,
    "FLAGS_REVOKED",
    `Revoked ${unbacked.join(", ")} — no validated field supports these. Validate the field in Document Review to earn them back.`,
    null
  ).catch(() => {});

  return unbacked;
}

/**
 * Platform-wide sweep.
 *
 * Runs on a schedule rather than only when something else triggers it: the
 * reversal path revokes flags for NGOs it re-opens, but an NGO carrying unbacked
 * flags and nothing else wrong is never re-opened, so its flags would have
 * stood forever. Those are exactly the ones nobody would notice.
 */
export async function sweepUnbackedComplianceFlags(): Promise<{
  checked: number;
  revoked: { ngoId: string; orgName: string; flags: string[] }[];
}> {
  const ngos = await prisma.nGOProfile.findMany({
    where: { isDeleted: false, compliance: { isNot: null } },
    select: { id: true, orgName: true },
  });

  const revoked: { ngoId: string; orgName: string; flags: string[] }[] = [];
  for (const ngo of ngos) {
    const flags = await revokeUnbackedFlags(ngo.id);
    if (flags.length > 0) revoked.push({ ngoId: ngo.id, orgName: ngo.orgName, flags });
  }

  return { checked: ngos.length, revoked };
}
