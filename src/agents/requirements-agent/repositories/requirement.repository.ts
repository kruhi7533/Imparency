import prisma from '@/lib/prisma';
import type { SponsorRequirement } from '@prisma/client';
import { commitRequirementChange } from '@/lib/requirements/commit';
import { normalizeFields } from '@/lib/requirements/provenance';
import type { ActorRole } from '@/lib/requirements/status';

export class SponsorRequirementRepository {
  /**
   * Creates the SponsorRequirement record for a freshly stored upload (UPLOADED).
   * Extraction fills the fields afterwards via the workflow pipeline.
   */
  static async create(data: {
    sponsorId: string;
    fileName: string;
    fileHash: string;
    storageKey: string;
    mimeType: string;
    fileSize: number;
    modelVersion?: string;
  }): Promise<SponsorRequirement> {
    return prisma.sponsorRequirement.create({
      data: {
        sponsorId: data.sponsorId,
        fileName: data.fileName,
        fileHash: data.fileHash,
        storageKey: data.storageKey,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        status: 'UPLOADED',
        modelVersion: data.modelVersion || 'gemini-3.6-flash',
      },
    });
  }

  /**
   * Finds a requirement by ID, including its revision history.
   */
  static async findById(id: string): Promise<any | null> {
    const requirement = await (prisma.sponsorRequirement as any).findUnique({
      where: { id },
      include: {
        revisions: {
          orderBy: { version: 'desc' },
          include: {
            changedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });
    return requirement;
  }

  /**
   * Finds this sponsor's earlier upload of the same file to detect duplicates.
   *
   * Scoped to the sponsor: two sponsors can legitimately upload the same
   * document, and returning another sponsor's record both leaked their data and
   * handed back a record the uploader was then forbidden to save.
   *
   * Failed and in-flight uploads (UPLOADED / PROCESSING) are not duplicates —
   * re-uploading retries them instead of reopening an empty record.
   */
  static async findByHash(fileHash: string, sponsorId: string): Promise<SponsorRequirement | null> {
    return prisma.sponsorRequirement.findFirst({
      where: {
        fileHash,
        sponsorId,
        status: { notIn: ['FAILED', 'UPLOADED', 'PROCESSING'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Versioned field update in its own transaction: snapshots the current
   * version into RequirementRevision, increments the version and records who
   * made the change. Status is unchanged. Prefer the workflow service for
   * user-facing edits (it also enforces who may edit in which status).
   */
  static async update(
    id: string,
    data: { extractedFields: unknown },
    meta: { actorId: string | null; actorRole: ActorRole; changeSummary: string }
  ): Promise<SponsorRequirement> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.sponsorRequirement.findUnique({ where: { id } });
      if (!current) throw new Error('Sponsor requirement not found');
      return commitRequirementChange(tx, current, {
        actorId: meta.actorId,
        actorRole: meta.actorRole,
        fields: normalizeFields(data.extractedFields),
        versionNote: meta.changeSummary,
        audit: {
          action: meta.actorRole === 'ADMIN' ? 'REQUIREMENT_EDITED_BY_ADMIN' : 'REQUIREMENT_EDITED_BY_DONOR',
          detail: meta.changeSummary,
        },
      });
    });
  }

  /**
   * Fetches all requirements for a specific sponsor.
   */
  static async findBySponsorId(sponsorId: string): Promise<SponsorRequirement[]> {
    return prisma.sponsorRequirement.findMany({
      where: { sponsorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Log an agent execution audit log.
   */
  static async logExecution(data: {
    agentName: string;
    action: string;
    entityId?: string;
    status: 'SUCCESS' | 'FAILED';
    promptHash: string;
    model: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    errorMessage?: string;
  }): Promise<void> {
    await prisma.agentExecution.create({
      data: {
        agentName: data.agentName,
        action: data.action,
        entityId: data.entityId,
        status: data.status,
        promptHash: data.promptHash,
        model: data.model,
        latencyMs: data.latencyMs,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        totalTokens: data.totalTokens,
        errorMessage: data.errorMessage,
      },
    });
  }
}
