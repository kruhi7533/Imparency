import prisma from "@/lib/prisma";

export type AlertCategory = "DOCUMENT_ERROR" | "FRAUD_ALERT";
export type AlertSubType =
  | "MISSING_DOCUMENT"
  | "WRONG_DOCUMENT_TYPE"
  | "EXPIRED_DOCUMENT"
  | "UNREADABLE_DOCUMENT"
  | "NAME_MISMATCH"
  | "DUPLICATE_IDENTITY"
  | "PAN_API_MISMATCH"
  | "FAKE_REGISTRATION"
  | "TAMPERED_DOCUMENT";

export async function createFraudAlert(
  type: string,
  entityId: string,
  entityType: string,
  description: string,
  severity: "LOW" | "MEDIUM" | "HIGH",
  alertCategory: AlertCategory = "FRAUD_ALERT",
  subType?: AlertSubType
): Promise<void> {
  try {
    // Raising the same unresolved alert twice is never right: it is one problem
    // a human has not dealt with yet, and a second row does not make it more
    // true — it makes the queue unreadable. Verification triage re-runs on
    // every re-verification and re-raised its whole finding set each time, so
    // one NGO with three document defects accumulated three rows per run.
    //
    // The key includes DESCRIPTION deliberately. Call sites in lib/risk-agent
    // dedupe on (type, entityId) alone, which is right for them because one
    // type means one problem there. VERIFICATION_DEFECT is the opposite: an
    // NGO can legitimately fail the name, registration and PAN checks at once,
    // and those are three separate things to fix. Keying without description
    // would hide two of them.
    const duplicate = await prisma.fraudAlert.findFirst({
      where: { type, entityId, description, resolved: false },
      select: { id: true },
    });
    if (duplicate) {
      // Not an error, and not worth a log line on every re-verification.
      return;
    }

    const created = await prisma.fraudAlert.create({
      data: {
        type,
        entityId,
        entityType,
        description,
        severity,
        alertCategory,
        subType,
        resolved: false
      }
    });
    console.log(`[${alertCategory} - ${severity}]: ${type} on ${entityType} ${entityId} - ${description}`);

    // Every HIGH-severity NGO alert is a candidate for a full investigation,
    // regardless of which of the platform's many call sites raised it. See
    // lib/fraud-investigator/trigger.ts for why this lives here and not at
    // each call site.
    const { maybeInvestigate } = await import("@/lib/fraud-investigator/trigger");
    await maybeInvestigate(entityType, entityId, severity, created.id);
  } catch (error) {
    console.error("Failed to create fraud alert:", error);
  }
}

/**
 * Checks if the same PAN number is used by multiple users.
 * Triggered during registration / updates.
 */
export async function checkPANUsage(panNumber: string, userId: string): Promise<void> {
  if (!panNumber) return;

  try {
    const duplicateUsers = await prisma.user.findMany({
      where: {
        panNumber,
        id: { not: userId }
      }
    });

    if (duplicateUsers.length > 0) {
      await createFraudAlert(
        "DUPLICATE_PAN_REGISTRATION",
        userId,
        "DONOR",
        `PAN number is already registered to ${duplicateUsers.length} other account${duplicateUsers.length > 1 ? "s" : ""}. Manual identity verification required.`,
        "HIGH",
        "FRAUD_ALERT",
        "DUPLICATE_IDENTITY"
      );
    }
  } catch (error) {
    console.error("Error checking PAN usage:", error);
  }
}


