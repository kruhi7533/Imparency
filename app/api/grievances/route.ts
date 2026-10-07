import { NextResponse } from "next/server";
import { GrievanceCategory } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

/** 5 complaints per hour per caller. Generous for anyone with a real problem,
 *  and low enough that this cannot be used to bury the queue. */
const GRIEVANCE_RATE_LIMIT = 5;
const GRIEVANCE_RATE_WINDOW_SECONDS = 3600;

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

/**
 * File a grievance against an organisation.
 *
 * SIGNED IN, ANY ROLE — `verifySessionRole()` with no argument. Deliberately
 * not restricted to donors: an NGO's own staff reporting their employer is
 * whistleblowing and is exactly the report least likely to arrive any other
 * way. Admins can file too; nothing is gained by making them use a different
 * door.
 *
 * What this route will NOT accept from the caller:
 *
 *   - `severity` — set by an admin at triage. A reporter who could mark their
 *     own complaint CRITICAL would, and so would everyone else.
 *   - `status` — every complaint starts OPEN. There is no way to file
 *     something pre-resolved.
 *
 * Both are ignored rather than rejected: a client that sends them is confused,
 * not hostile, and failing the submission would lose a real complaint over a
 * field the reporter never saw.
 *
 * NOTE on who can read this afterwards: nobody except an admin. There is no
 * GET here and no NGO route anywhere that reads this table — an organisation
 * being able to list complaints against itself would identify whoever filed
 * them. See the comment on the Grievance model.
 */
export async function POST(request: Request) {
  const rl = await checkRateLimit(
    request,
    "grievances",
    GRIEVANCE_RATE_LIMIT,
    GRIEVANCE_RATE_WINDOW_SECONDS
  );
  if (rl.isBlocked) return rl.response!;

  const { authorized, response, session } = await verifySessionRole();
  if (!authorized) return response;

  let body: {
    ngoId?: unknown;
    projectId?: unknown;
    category?: unknown;
    subject?: unknown;
    body?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ngoId = typeof body.ngoId === "string" ? body.ngoId.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const projectId = typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;

  if (!ngoId) {
    return NextResponse.json({ error: "Say which organisation this is about." }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "A one-line summary is required." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Describe what happened." }, { status: 400 });
  }
  if (subject.length > SUBJECT_MAX || text.length > BODY_MAX) {
    return NextResponse.json(
      { error: `Keep the summary under ${SUBJECT_MAX} characters and the description under ${BODY_MAX}.` },
      { status: 400 }
    );
  }

  // hasOwnProperty, not `in`: `in` would accept "toString" as a category and
  // hand Prisma a value its enum has never heard of.
  const category =
    typeof body.category === "string" &&
    Object.prototype.hasOwnProperty.call(GrievanceCategory, body.category)
      ? (body.category as GrievanceCategory)
      : GrievanceCategory.OTHER;

  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: ngoId },
    select: { id: true },
  });
  if (!ngo) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  }

  // A project, if named, must belong to the organisation being complained
  // about. Otherwise the complaint would point at two unrelated parties and an
  // admin could not tell which one it concerns.
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ngoId: true },
    });
    if (!project || project.ngoId !== ngoId) {
      return NextResponse.json(
        { error: "That project does not belong to the organisation named." },
        { status: 400 }
      );
    }
  }

  const grievance = await prisma.grievance.create({
    data: {
      ngoId,
      projectId,
      reporterId: session.user.id,
      category,
      subject,
      body: text,
      // status defaults to OPEN; severity stays null until an admin triages.
    },
    select: { id: true, status: true, createdAt: true },
  });

  // No admin log here: logAdminAction records what an ADMIN did. Filing is the
  // reporter's act, and the row itself is the record of it.
  return NextResponse.json(
    {
      id: grievance.id,
      status: grievance.status,
      filedAt: grievance.createdAt,
      message:
        "Your report has been filed and will be reviewed by the platform team. " +
        "Nobody at the organisation you reported can see it.",
    },
    { status: 201 }
  );
}
