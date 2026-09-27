import type { Prisma, RequirementStatus, SponsorRequirement } from "@prisma/client";
import type prisma from "@/lib/prisma";
import { assertTransition, type ActorRole } from "./status";
import { ERRORS } from "./errors";
import { recordRequirementEvent, type RequirementAuditAction } from "./audit";
import { confidenceMap, type RequirementFields } from "./provenance";

/**
 * Interactive-transaction client of the shared (retry-extended) Prisma client.
 * Prisma.TransactionClient is the *unextended* type and does not accept it.
 */
export type Tx = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface RequirementChange {
  actorId: string | null;
  actorRole: ActorRole;
  /** Target status; validated against the state machine. */
  toStatus?: RequirementStatus;
  /** New field map. Triggers a version bump + snapshot of the previous fields. */
  fields?: RequirementFields;
  /** How this new version came to be (e.g. "Donor corrected minimum budget"). */
  versionNote?: string;
  /** Other columns to set (review metadata, raw text, selection…). */
  data?: Prisma.SponsorRequirementUpdateManyMutationInput;
  audit: { action: RequirementAuditAction; detail?: string; metadata?: Record<string, unknown> };
}

function hasFields(json: unknown): boolean {
  return !!json && typeof json === "object" && Object.keys(json as object).length > 0;
}

/**
 * The single write path for requirement state. Inside the caller's transaction:
 *   1. validates the status transition for the actor's role,
 *   2. snapshots the current fields into RequirementRevision (never destroys history),
 *   3. writes the change guarded by the version AND status that were read —
 *      a concurrent edit/transition makes this a 409 instead of a lost update,
 *   4. appends the audit event.
 * The first extraction fills the empty upload placeholder and stays v1.
 */
export async function commitRequirementChange(
  tx: Tx,
  current: SponsorRequirement,
  change: RequirementChange
): Promise<SponsorRequirement> {
  if (change.toStatus && change.toStatus !== current.status) {
    assertTransition(current.status, change.toStatus, change.actorRole);
  }

  const data: Prisma.SponsorRequirementUpdateManyMutationInput = { ...(change.data ?? {}) };
  if (change.toStatus) data.status = change.toStatus;

  if (change.fields) {
    const snapshot = hasFields(current.extractedFields);
    if (snapshot) {
      await tx.requirementRevision.create({
        data: {
          sponsorRequirementId: current.id,
          version: current.version,
          extractedFields: current.extractedFields as any,
          changeSummary: current.versionNote,
          changedById: current.versionAuthorId,
          changedByRole: current.versionAuthorRole,
          status: current.status,
        },
      });
    }
    data.extractedFields = change.fields as any;
    data.confidenceScores = confidenceMap(change.fields);
    data.version = snapshot ? current.version + 1 : current.version;
    data.versionNote = change.versionNote ?? null;
    data.versionAuthorId = change.actorId;
    data.versionAuthorRole = change.actorRole;
  }

  const { count } = await tx.sponsorRequirement.updateMany({
    where: { id: current.id, version: current.version, status: current.status },
    data,
  });
  if (count === 0) throw ERRORS.conflict();

  await recordRequirementEvent(tx, {
    requirementId: current.id,
    action: change.audit.action,
    actorId: change.actorId,
    actorRole: change.actorRole,
    fromStatus: current.status,
    toStatus: change.toStatus ?? current.status,
    detail: change.audit.detail ?? null,
    metadata: change.audit.metadata ?? null,
  });

  const updated = await tx.sponsorRequirement.findUnique({ where: { id: current.id } });
  if (!updated) throw ERRORS.notFound();
  return updated;
}
