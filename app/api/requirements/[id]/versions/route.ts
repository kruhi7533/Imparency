import { NextResponse } from "next/server";
import { requireActor, loadRequirementForActor } from "@/lib/requirements/access";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse } from "@/lib/requirements/http";

/** Version history (owner/admin): the current version plus every archived snapshot. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const requirement = await loadRequirementForActor(params.id, actor, {
      revisions: { orderBy: { version: "desc" as const }, include: { changedBy: { select: { name: true, email: true } } } },
    });
    const dto = serializeRequirement(requirement);
    return NextResponse.json({
      current: {
        version: dto.version,
        fields: dto.fields,
        versionNote: dto.versionNote,
        versionAuthorRole: dto.versionAuthorRole,
        status: dto.status,
        updatedAt: dto.updatedAt,
      },
      revisions: dto.revisions ?? [],
    });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/versions");
  }
}
