import type { OpportunityResponseStatus } from "@prisma/client";
import { RequirementWorkflowError } from "./errors";
import type { ActorRole } from "./status";

/**
 * NGO response (proposal) state machine — the single source of truth for which
 * status changes are legal on an OpportunityResponse and who may make them.
 * Modelled on lib/requirements/status.ts. Pure (no Prisma client import) so the
 * UI can share the labels.
 *
 *   INTERESTED ──NGO──▶ PROPOSAL_SUBMITTED ──DONOR/ADMIN──▶ CHANGES_REQUESTED
 *                              ▲                                   │
 *                              └──────────────NGO (revision)───────┘
 *   PROPOSAL_SUBMITTED ──DONOR/ADMIN──▶ SELECTED ("Proposal approved")
 *   any open status    ──DONOR/ADMIN──▶ REJECTED (also: every other response
 *                                       when one is selected)
 *
 * UNDER_REVIEW and SHORTLISTED are given legal exits rather than deleted, so a
 * future "donor is reading this" marker has somewhere to land. Nothing writes
 * them yet. (docs/WEEK5-SPECS.md SPEC-3)
 */
export type { OpportunityResponseStatus };

const RESPONSE_TRANSITIONS: Record<OpportunityResponseStatus, Partial<Record<OpportunityResponseStatus, ActorRole[]>>> = {
  INTERESTED: { PROPOSAL_SUBMITTED: ["NGO"], REJECTED: ["DONOR", "ADMIN"] },
  PROPOSAL_SUBMITTED: {
    CHANGES_REQUESTED: ["DONOR", "ADMIN"],
    SELECTED: ["DONOR", "ADMIN"],
    REJECTED: ["DONOR", "ADMIN"],
  },
  CHANGES_REQUESTED: { PROPOSAL_SUBMITTED: ["NGO"], REJECTED: ["DONOR", "ADMIN"] },
  UNDER_REVIEW: {
    CHANGES_REQUESTED: ["DONOR", "ADMIN"],
    SELECTED: ["DONOR", "ADMIN"],
    REJECTED: ["DONOR", "ADMIN"],
  },
  SHORTLISTED: { SELECTED: ["DONOR", "ADMIN"], REJECTED: ["DONOR", "ADMIN"] },
  REJECTED: {},
  SELECTED: {},
};

export const RESPONSE_STATUSES = Object.keys(RESPONSE_TRANSITIONS) as OpportunityResponseStatus[];

/** Statuses in which the NGO may still edit its response. */
export const NGO_EDITABLE_RESPONSE: OpportunityResponseStatus[] = ["INTERESTED", "PROPOSAL_SUBMITTED", "CHANGES_REQUESTED"];

/** Statuses that hold a full proposal — every resubmission from one of these is a new version. */
export const PROPOSAL_STATUSES: OpportunityResponseStatus[] = ["PROPOSAL_SUBMITTED", "CHANGES_REQUESTED", "UNDER_REVIEW", "SHORTLISTED"];

export function canTransitionResponse(from: OpportunityResponseStatus, to: OpportunityResponseStatus, role: ActorRole): boolean {
  return RESPONSE_TRANSITIONS[from]?.[to]?.includes(role) ?? false;
}

/** Throws 400 for an illegal transition, 403 for a legal one this role may not make. */
export function assertResponseTransition(from: OpportunityResponseStatus, to: OpportunityResponseStatus, role: ActorRole): void {
  const allowedRoles = RESPONSE_TRANSITIONS[from]?.[to];
  if (!allowedRoles) {
    throw new RequirementWorkflowError(
      `This action is not available while the proposal is ${RESPONSE_STATUS_LABELS[from].toLowerCase()}.`,
      400
    );
  }
  if (!allowedRoles.includes(role)) {
    throw new RequirementWorkflowError("You do not have permission to perform this action.", 403);
  }
}

/** Donor/admin-facing labels. */
export const RESPONSE_STATUS_LABELS: Record<OpportunityResponseStatus, string> = {
  INTERESTED: "Interested",
  PROPOSAL_SUBMITTED: "Proposal submitted",
  CHANGES_REQUESTED: "Changes requested",
  UNDER_REVIEW: "Under review",
  SHORTLISTED: "Shortlisted",
  REJECTED: "Not selected",
  SELECTED: "Proposal approved",
};

/**
 * NGO-facing labels. A REJECTED response is usually an auto-decline because
 * another proposal was approved, so it never renders as a bare "Rejected",
 * which reads as a judgement on the organisation (SPEC-6).
 */
export const NGO_RESPONSE_STATUS_LABELS: Record<OpportunityResponseStatus, string> = {
  INTERESTED: "Interest recorded",
  PROPOSAL_SUBMITTED: "Proposal submitted — with the sponsor",
  CHANGES_REQUESTED: "Changes requested by the sponsor",
  UNDER_REVIEW: "Under review",
  SHORTLISTED: "Shortlisted",
  REJECTED: "Not selected for this opportunity",
  SELECTED: "Proposal approved — ready for contracting",
};

/** Change-request note bounds: a request with no change named is a dead end. */
export const CHANGE_NOTE_MIN = 10;
export const CHANGE_NOTE_MAX = 4000;
