import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { draftNudgeMessage } from "@/lib/gemini/draft-ngo-nudge";

export const runtime = "nodejs";

/**
 * ADMIN-only, on-demand. Drafts a reminder message for a quiet/overdue NGO —
 * AI drafts, admin reviews and edits before sending. Never sends anything
 * itself; the admin copies the draft into ask-ngo or their own email client.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  const rl = await checkRateLimit(request, "admin/ngo-nudge", 20, 60);
  if (rl.isBlocked) return rl.response!;

  try {
    const body = await request.json().catch(() => ({}));
    const reason = body.reason;
    if (!reason || !["QUIET", "OVERDUE_MILESTONE"].includes(reason)) {
      return NextResponse.json({ error: "reason must be QUIET or OVERDUE_MILESTONE" }, { status: 400 });
    }

    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        orgName: true,
        projects: {
          where: { status: "ACTIVE" },
          select: {
            title: true,
            milestones: {
              where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
              select: { title: true, deadline: true },
              orderBy: { deadline: "asc" },
              take: 3,
            },
          },
          take: 5,
        },
      },
    });
    if (!ngo) {
      return NextResponse.json({ error: "NGO not found" }, { status: 404 });
    }

    const overdueMilestones = ngo.projects
      .flatMap((p) => p.milestones.map((m) => ({ projectTitle: p.title, milestoneTitle: m.title, deadline: m.deadline })))
      .filter((m) => m.deadline < new Date());

    const draft = await draftNudgeMessage({
      orgName: ngo.orgName,
      reason,
      activeProjectTitles: ngo.projects.map((p) => p.title),
      overdueMilestones,
    });

    return NextResponse.json({ draft });
  } catch (err: any) {
    console.error("NGO nudge draft route error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
