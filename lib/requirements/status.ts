import type { RequirementStatus } from "@prisma/client";
import { RequirementWorkflowError } from "./errors";

/**
 * CSR requirement state machine — the single source of truth for which status
 * changes are legal and who may make them. Every status write in the workflow
 * goes through assertTransition(); routes never set `status` directly.
 *
 * SYSTEM = the server pipeline itself (extraction, matching), never a user.
 */
export type ActorRole = "DONOR" | "NGO" | "ADMIN" | "SYSTEM";

export type { RequirementStatus };

const TRANSITIONS: Record<RequirementStatus, Partial<Record<RequirementStatus, ActorRole[]>>> = {
  UPLOADED: { PROCESSING: ["SYSTEM"], FAILED: ["SYSTEM"] },
  PROCESSING: { AI_EXTRACTED: ["SYSTEM"], FAILED: ["SYSTEM"] },
  // Re-running extraction (→ PROCESSING) is an admin tool at every review stage.
  AI_EXTRACTED: { DONOR_REVIEW: ["DONOR"], PROCESSING: ["ADMIN"] },
  DONOR_REVIEW: { PENDING_ADMIN_REVIEW: ["DONOR"], NEEDS_CORRECTION: ["ADMIN"], PROCESSING: ["ADMIN"] },
  PENDING_ADMIN_REVIEW: {
    VALIDATED: ["ADMIN"],
    NEEDS_CORRECTION: ["ADMIN"],
    REJECTED: ["ADMIN"],
    PROCESSING: ["ADMIN"],
  },
  NEEDS_CORRECTION: { PENDING_ADMIN_REVIEW: ["DONOR"], PROCESSING: ["ADMIN"] },
  VALIDATED: { MATCHING: ["DONOR", "ADMIN"] },
  // A run with no eligible candidates (or a crash) returns the requirement to VALIDATED.
  MATCHING: { SHORTLISTED: ["SYSTEM"], VALIDATED: ["SYSTEM"] },
  // Re-matching is only allowed before any NGO has been invited (checked in the service).
  SHORTLISTED: { NGO_RESPONSE: ["NGO"], MATCHING: ["DONOR", "ADMIN"] },
  NGO_RESPONSE: { SELECTED: ["DONOR", "ADMIN"] },
  SELECTED: { CONTRACTED: ["DONOR", "NGO", "ADMIN"] },
  CONTRACTED: {},
  REJECTED: {},
  // A failed extraction can be retried by the owner or an admin.
  FAILED: { PROCESSING: ["DONOR", "ADMIN"] },
};

export function canTransition(from: RequirementStatus, to: RequirementStatus, role: ActorRole): boolean {
  return TRANSITIONS[from]?.[to]?.includes(role) ?? false;
}

/** Throws 400 for an illegal transition, 403 for a legal one this role may not make. */
export function assertTransition(from: RequirementStatus, to: RequirementStatus, role: ActorRole): void {
  const allowedRoles = TRANSITIONS[from]?.[to];
  if (!allowedRoles) {
    throw new RequirementWorkflowError(
      `This action is not available while the requirement is ${STATUS_LABELS[from].toLowerCase()}.`,
      400
    );
  }
  if (!allowedRoles.includes(role)) {
    throw new RequirementWorkflowError("You do not have permission to perform this action.", 403);
  }
}

/** Statuses in which the owning donor may edit extracted fields. */
export const DONOR_EDITABLE: RequirementStatus[] = ["AI_EXTRACTED", "DONOR_REVIEW", "NEEDS_CORRECTION"];
/** Statuses in which an admin may edit extracted fields (as part of verification). */
export const ADMIN_EDITABLE: RequirementStatus[] = ["PENDING_ADMIN_REVIEW"];
/** Statuses that are past admin validation (matching results may exist). */
export const POST_VALIDATION: RequirementStatus[] = [
  "VALIDATED",
  "MATCHING",
  "SHORTLISTED",
  "NGO_RESPONSE",
  "SELECTED",
  "CONTRACTED",
];

export const STATUS_LABELS: Record<RequirementStatus, string> = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing",
  AI_EXTRACTED: "AI extracted",
  DONOR_REVIEW: "In donor review",
  PENDING_ADMIN_REVIEW: "Pending admin review",
  NEEDS_CORRECTION: "Needs correction",
  VALIDATED: "Validated",
  MATCHING: "Matching",
  SHORTLISTED: "Shortlisted",
  NGO_RESPONSE: "NGO responses",
  SELECTED: "NGO selected",
  CONTRACTED: "Contracted",
  REJECTED: "Rejected",
  FAILED: "Processing failed",
};
