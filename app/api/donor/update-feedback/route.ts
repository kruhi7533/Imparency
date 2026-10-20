import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { donorFollowsOrFunds, parseFeedback } from "@/lib/donor-feedback";

/**
 * PUT /api/donor/update-feedback { projectId, eventId?, signal, note? }
 *
 * The signed-in donor rates a project's updates — one specific feed event, or
 * the project's updates overall. Upsert: changing your mind replaces your
 * earlier answer rather than adding a second vote. Only a donor who funds or
 * follows the project may answer; an event must belong to that project.
 */
export async function PUT(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;

  const parsed = parseFeedback(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { projectId, eventKey, signal, note } = parsed.value;
  const donorId = session.user.id;

  if (!(await donorFollowsOrFunds(donorId, projectId))) {
    return NextResponse.json({ error: "You can only give feedback on projects you fund or follow." }, { status: 403 });
  }
  if (eventKey) {
    const event = await prisma.projectImpactEvent.findUnique({ where: { id: eventKey }, select: { projectId: true } });
    if (!event || event.projectId !== projectId) return NextResponse.json({ error: "Update not found." }, { status: 404 });
  }

  const feedback = await prisma.donorUpdateFeedback.upsert({
    where: { donorId_projectId_eventKey: { donorId, projectId, eventKey } },
    create: { donorId, projectId, eventKey, signal, note },
    update: { signal, note },
    select: { signal: true, note: true },
  });
  return NextResponse.json({ feedback });
}
