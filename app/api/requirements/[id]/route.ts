import { NextResponse } from 'next/server';
import { requireActor, loadRequirementForActor } from '@/lib/requirements/access';
import { editRequirementFields } from '@/lib/requirements/workflow';
import { serializeRequirement } from '@/lib/requirements/dto';
import { errorResponse, readJson } from '@/lib/requirements/http';

const DETAIL_INCLUDE = {
  sponsor: { select: { id: true, name: true, email: true, companyName: true } },
  revisions: {
    orderBy: { version: 'desc' as const },
    include: { changedBy: { select: { name: true, email: true } } },
  },
};

/** Owner or admin only. Never returns the private storage key. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const requirement = await loadRequirementForActor(params.id, actor, DETAIL_INCLUDE);
    return NextResponse.json({ requirement: serializeRequirement(requirement, { includeRawText: true }) });
  } catch (err) {
    return errorResponse(err, 'api/requirements/[id] GET');
  }
}

/**
 * Edit extracted fields. Body: { fields: { <fieldKey>: <value> } }.
 * Only values are accepted — confidence and provenance are set server-side.
 * Donor: AI_EXTRACTED / DONOR_REVIEW / NEEDS_CORRECTION. Admin: PENDING_ADMIN_REVIEW.
 * This never validates a requirement; use submit-review / admin-approve.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const body = await readJson(request);
    let edits = body.fields;
    // Legacy clients sent { extractedFields: { key: { value, confidence } } } — take values only.
    if (!edits && body.extractedFields && typeof body.extractedFields === 'object') {
      edits = Object.fromEntries(Object.entries(body.extractedFields).map(([k, v]: [string, any]) => [k, v?.value ?? null]));
    }
    await editRequirementFields(params.id, actor, edits, request);
    const requirement = await loadRequirementForActor(params.id, actor, DETAIL_INCLUDE);
    return NextResponse.json({ requirement: serializeRequirement(requirement, { includeRawText: true }) });
  } catch (err) {
    return errorResponse(err, 'api/requirements/[id] PUT');
  }
}
