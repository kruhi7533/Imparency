import { NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { uploadPrivateFile, deletePrivateFile } from '@/lib/storage';
import { SponsorRequirementRepository } from '@/src/agents/requirements-agent/repositories/requirement.repository';
import { LlmUnavailableError } from '@/src/agents/requirements-agent/services/llm/llm.service';
import { getActor } from '@/lib/requirements/access';
import { recordRequirementEvent, recordRequirementEventBestEffort } from '@/lib/requirements/audit';
import { runExtraction } from '@/lib/requirements/extraction';
import { serializeRequirement } from '@/lib/requirements/dto';
import { RequirementWorkflowError } from '@/lib/requirements/errors';
import { detectRequirementFileType, MAX_REQUIREMENT_FILE_BYTES } from '@/lib/requirements/file-types';

export const runtime = 'nodejs';

/**
 * Donor uploads a CSR/RFP document:
 *   validate (size, extension + magic bytes) → SHA-256 → per-donor duplicate check
 *   → PRIVATE storage (random key, never a public URL) → UPLOADED
 *   → Requirements Analyst Agent → AI_EXTRACTED (or FAILED, retryable).
 */
export async function POST(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: 'Please sign in to continue.' }, { status: 401 });
  if (actor.role !== 'DONOR') {
    return NextResponse.json({ error: 'Only donor accounts can upload CSR documents.' }, { status: 403 });
  }

  // Resolve the sponsor from the session (by id, falling back to email), auto-healing
  // a missing user row after a DB re-sync — pre-existing behaviour, kept as is.
  let user = await prisma.user.findFirst({
    where: { OR: [{ id: actor.id }, ...(actor.email ? [{ email: actor.email }] : [])] },
  });
  if (!user && actor.email) {
    user = await prisma.user.create({
      data: {
        id: actor.id,
        email: actor.email,
        name: actor.name || 'Donor User',
        role: 'DONOR',
        passwordHash: 'oauth-or-session-restored',
      },
    });
  }
  if (!user) {
    return NextResponse.json({ error: 'Your session is invalid. Please log out and log in again.' }, { status: 401 });
  }
  const sponsorId = user.id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Upload a file using multipart form data.' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400 });
  if (file.size > MAX_REQUIREMENT_FILE_BYTES) {
    return NextResponse.json({ error: 'File size exceeds the 10MB limit' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectRequirementFileType(file.name, buffer);
  if (!type) {
    return NextResponse.json(
      { error: 'File type not supported. Allowed formats: PDF, DOCX, JPG, PNG, WEBP (the file content must match its extension).' },
      { status: 400 }
    );
  }
  const fileName = file.name.slice(0, 255);
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  const existing = await SponsorRequirementRepository.findByHash(fileHash, sponsorId);
  if (existing) {
    await recordRequirementEventBestEffort({
      requirementId: existing.id,
      action: 'CSR_HASH_DUPLICATE',
      actorId: sponsorId,
      actorRole: 'DONOR',
      detail: `Re-upload of identical content (${fileName}) returned the existing requirement.`,
    });
    return NextResponse.json({
      requirement: serializeRequirement(existing),
      isDuplicate: true,
      message: 'An identical CSR document has already been uploaded.',
    });
  }

  const storageKey = await uploadPrivateFile(buffer, `.${type.ext}`, 'requirements');
  let requirement;
  try {
    requirement = await prisma.$transaction(async (tx) => {
      const created = await tx.sponsorRequirement.create({
        data: {
          sponsorId,
          fileName,
          fileHash,
          storageKey,
          mimeType: type.mime,
          fileSize: buffer.length,
          status: 'UPLOADED',
          modelVersion: 'gemini-3.6-flash',
        },
      });
      await recordRequirementEvent(tx, {
        requirementId: created.id,
        action: 'CSR_UPLOADED',
        actorId: sponsorId,
        actorRole: 'DONOR',
        toStatus: 'UPLOADED',
        detail: `${fileName} uploaded (${type.mime}, ${buffer.length} bytes).`,
        metadata: { fileHash },
      });
      return created;
    });
  } catch (err) {
    await deletePrivateFile(storageKey).catch(() => {});
    console.error('CSR upload: failed to create requirement:', err);
    return NextResponse.json({ error: 'Could not save the document. Please try again.' }, { status: 500 });
  }

  try {
    const extracted = await runExtraction({
      requirement,
      buffer,
      startedBy: { id: null, role: 'SYSTEM' },
      isRerun: false,
    });
    return NextResponse.json({
      requirement: serializeRequirement(extracted, { includeRawText: true }),
      isDuplicate: false,
      message: 'CSR document processed successfully.',
    });
  } catch (err: any) {
    // The requirement exists (status FAILED) — return its id so the UI can offer a retry.
    const unavailable = err instanceof LlmUnavailableError;
    const status = unavailable ? 503 : err instanceof RequirementWorkflowError ? err.status : 500;
    if (!unavailable && !(err instanceof RequirementWorkflowError)) console.error('CSR Requirement Upload Error:', err);
    return NextResponse.json(
      {
        error: unavailable || err instanceof RequirementWorkflowError ? err.message : 'Document processing failed. You can retry extraction.',
        retryable: true,
        requirementId: requirement.id,
      },
      { status }
    );
  }
}
