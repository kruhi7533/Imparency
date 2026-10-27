import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkRateLimit } from "@/lib/rate-limiter";
import { replayDeadLetter } from "@/lib/dead-letter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/dead-letters/[id]/replay — one-time replay (ADM-018 /
 * NEG-012). OPEN -> REPLAYING is a compare-and-swap: a second replay of the
 * same entry gets 409 and runs nothing. 200 when the replay worked, 502 when it
 * ran and failed again (the entry is then REPLAY_FAILED and can be dismissed).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  const rl = await checkRateLimit(request, "admin/dead-letter-replay", 20, 60);
  if (rl.isBlocked) return rl.response;

  const outcome = await replayDeadLetter(params.id, { adminId: auth.session.user.id, origin: new URL(request.url).origin });
  if ("conflict" in outcome) {
    if (outcome.currentStatus === null) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(
      { error: `Already ${outcome.currentStatus.toLowerCase().replace("_", " ")} — a dead letter can be replayed once.`, status: outcome.currentStatus },
      { status: 409 }
    );
  }

  await logAdminAction({
    adminId: auth.session.user.id,
    action: "DEAD_LETTER_REPLAYED",
    entityType: "DEAD_LETTER",
    entityId: params.id,
    oldValue: { status: "OPEN" },
    newValue: { status: outcome.status },
    request,
  });

  return NextResponse.json({ status: outcome.status, result: outcome.result }, { status: outcome.ok ? 200 : 502 });
}
