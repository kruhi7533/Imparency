import { DonorCategory } from "@prisma/client";
import { deriveFcraStatus } from "@/lib/ngo-compliance";

export const DECLARATION_VERSION = "1.0";

/**
 * Returns true when this donor's category requires a valid NGO FCRA registration.
 *
 * INDIAN_IN_INDIA  → domestic, no FCRA needed
 * INDIAN_ABROAD    → treated as foreign source UNLESS they declared an NRI-eligible
 *                    account (FEMA-compliant NRE/NRO routed through Indian banking)
 * FOREIGN_NATIONAL → always requires FCRA regardless of account type
 */
export function donorRequiresFcra(
  category: DonorCategory | null | undefined,
  nriSourceDeclaration?: string | null
): boolean {
  if (!category) return false; // undeclared donors are treated as domestic (benefit of doubt)
  if (category === "INDIAN_IN_INDIA") return false;
  if (category === "FOREIGN_NATIONAL") return true;
  // INDIAN_ABROAD: only exempt if they declared a FEMA-compliant NRI source
  return nriSourceDeclaration !== "ELIGIBLE_NRI_SOURCE";
}

/**
 * Pure gate check. Returns a structured result so callers can surface the right
 * message without duplicating the logic.
 */
export type FcraGateResult =
  | { allowed: true }
  | { allowed: false; reason: "FCRA_REQUIRED"; fcraStatus: string }
  | { allowed: false; reason: "DECLARATION_REQUIRED" };

export function checkFcraGate(params: {
  donorCategory: DonorCategory | null | undefined;
  nriSourceDeclaration: string | null | undefined;
  ngoFcraExpiryDate: Date | null | undefined;
  ngoFcraStatus: string;
}): FcraGateResult {
  const { donorCategory, nriSourceDeclaration, ngoFcraExpiryDate, ngoFcraStatus } = params;

  if (!donorRequiresFcra(donorCategory, nriSourceDeclaration)) {
    return { allowed: true };
  }

  // Recompute live status from expiry date for approved certs
  const liveStatus =
    ngoFcraExpiryDate &&
    ["ACTIVE", "EXPIRING_SOON", "EXPIRED"].includes(ngoFcraStatus)
      ? (deriveFcraStatus(ngoFcraExpiryDate) ?? ngoFcraStatus)
      : ngoFcraStatus;

  if (liveStatus === "ACTIVE") {
    return { allowed: true };
  }

  return { allowed: false, reason: "FCRA_REQUIRED", fcraStatus: liveStatus };
}
