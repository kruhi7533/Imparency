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
    await prisma.fraudAlert.create({
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


