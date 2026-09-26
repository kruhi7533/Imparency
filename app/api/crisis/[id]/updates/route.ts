import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";

const UPDATE_TYPES = ["PHOTO", "VIDEO", "REPORT", "FUND_UTILIZATION", "BENEFICIARY_UPDATE", "TEXT"];

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const rl = await checkRateLimit(request, "crisis/updates-create", 30, 3600);
    if (rl.isBlocked) return rl.response;

    const event = await prisma.crisisEvent.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });

    // Poster must be either an NGO that has joined this crisis, or the
    // submitter of a published initiative under it.
    let postedByNgoId: string | null = null;
    let initiativeId: string | null = null;

    if (session.user.role === "NGO") {
      const profile = await prisma.nGOProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
      if (profile) {
        const participant = await prisma.crisisParticipant.findUnique({
          where: { crisisEventId_ngoId: { crisisEventId: event.id, ngoId: profile.id } },
        });
        if (participant) postedByNgoId = profile.id;
      }
    }

    const formData = await request.formData();
    const requestedInitiativeId = formData.get("initiativeId") as string | null;
    if (!postedByNgoId && requestedInitiativeId) {
      const initiative = await prisma.reliefInitiative.findUnique({ where: { id: requestedInitiativeId } });
      if (initiative && initiative.submittedById === session.user.id && initiative.crisisEventId === event.id) {
        initiativeId = initiative.id;
      }
    }

    if (!postedByNgoId && !initiativeId) {
      return NextResponse.json(
        { error: "Only a joined NGO or the initiative's own submitter can post updates for this crisis" },
        { status: 403 }
      );
    }

    const type = formData.get("type") as string | null;
    const title = (formData.get("title") as string | null)?.trim();
    const body = (formData.get("body") as string | null)?.trim();
    const fundsUtilizedStr = formData.get("fundsUtilized") as string | null;
    const beneficiariesReachedStr = formData.get("beneficiariesReached") as string | null;
    const mediaFiles = formData.getAll("media") as File[];
    const documentFiles = formData.getAll("documents") as File[];

    if (!type || !UPDATE_TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid update type" }, { status: 400 });
    }
    if (!title || !body) {
      return NextResponse.json({ error: "title and body are required" }, { status: 400 });
    }
    if (mediaFiles.length > 6) {
      return NextResponse.json({ error: "A maximum of 6 media files is allowed" }, { status: 400 });
    }

    const mediaUrls: string[] = [];
    for (const file of mediaFiles) {
      if (!(file instanceof File) || file.size === 0) continue;
      mediaUrls.push(await uploadFile(Buffer.from(await file.arrayBuffer()), file.name, "crisis/updates"));
    }
    // Independent uploads, sent together rather than in series — see the same
    // change in `crisis/[id]/initiatives`. Promise.all preserves input order.
    const documentUrls = await Promise.all(
      documentFiles
        .filter((file) => file instanceof File && file.size > 0)
        .map(async (file) =>
          uploadFile(Buffer.from(await file.arrayBuffer()), file.name, "crisis/update-documents")
        )
    );

    const update = await prisma.crisisUpdate.create({
      data: {
        crisisEventId: event.id,
        postedById: session.user.id,
        postedByNgoId,
        initiativeId,
        type: type as any,
        title,
        body,
        mediaUrls,
        documentUrls,
        fundsUtilized: fundsUtilizedStr ? parseFloat(fundsUtilizedStr) : null,
        beneficiariesReached: beneficiariesReachedStr ? parseInt(beneficiariesReachedStr, 10) : null,
      },
    });

    return NextResponse.json({ id: update.id, createdAt: update.createdAt }, { status: 201 });
  } catch (err: any) {
    console.error("Crisis update creation error:", err);
    return NextResponse.json({ error: "We couldn't post this update right now. Please try again." }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor");
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

    const updates = await prisma.crisisUpdate.findMany({
      where: { crisisEventId: params.id },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        postedByNgo: { select: { orgName: true } },
        initiative: { select: { organizerName: true } },
      },
    });

    const hasMore = updates.length > limit;
    const page = hasMore ? updates.slice(0, limit) : updates;

    return NextResponse.json({
      updates: page.map((u) => ({
        ...u,
        fundsUtilized: u.fundsUtilized ? Number(u.fundsUtilized) : null,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (err: any) {
    console.error("Crisis updates list error:", err);
    return NextResponse.json({ error: "Failed to load updates" }, { status: 500 });
  }
}
