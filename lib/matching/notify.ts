import prisma from "@/lib/prisma";
import { appendToThread, openThread, type OpenThreadOptions } from "@/lib/inquiry-thread";

/**
 * The message an organisation receives when it is shortlisted.
 *
 * Kept in one place because two routes send it — the decision route, which
 * sends automatically, and the notify route, which repairs a candidate that was
 * decided before notification existed (or whose send failed). Two copies would
 * drift, and this text carries obligations.
 *
 * The wording is load-bearing, for a reason worth stating plainly:
 *
 * ImpactBridge verifies ORGANISATIONS hard — documents extracted, fields
 * validated by a human, compliance flags that must be backed by evidence. It
 * verifies FUNDERS not at all: `FundingOpportunity.funderName` is free text an
 * admin typed. So a shortlist email carries the platform's credibility to a
 * party the platform has not checked.
 *
 * That asymmetry is exactly the shape of an advance-fee scam ("you have been
 * selected for a grant, just pay the processing fee"). Until funder identity is
 * verified, the honest response is to say so in the message and to tell the
 * organisation what we will never ask them to do — the same principle as
 * "no evidence must never read as safe", applied to the funder side.
 */

export interface ShortlistMessageInput {
  opportunityTitle: string;
  funderName: string;
  /** The reviewer's note, if they left one. */
  note?: string | null;
}

export function buildShortlistSubject(opportunityTitle: string): string {
  return `Shortlisted: ${opportunityTitle}`;
}

export function buildShortlistMessage({
  opportunityTitle,
  funderName,
  note,
}: ShortlistMessageInput): string {
  return [
    `Your organisation has been shortlisted for "${opportunityTitle}", a funding opportunity from ${funderName}.`,
    ``,
    `This is not an award and not a commitment of funds — it means your organisation met the criteria this funder set, and we would like to talk.`,
    ``,
    `About the funder: ImpactBridge has verified your organisation's registration and compliance documents. We have NOT verified ${funderName} to that same standard. Treat this as an introduction, not an endorsement.`,
    ``,
    `ImpactBridge will never ask you to pay a fee, send money, or share bank credentials to secure a grant. If anyone asks you to, tell us on this thread.`,
    ...(note ? [``, `Note from the reviewer: ${note}`] : []),
    ``,
    `Reply here to register your interest or ask anything about the opportunity.`,
  ].join("\n");
}

/**
 * Has this organisation already been told about this opportunity?
 *
 * Threads opened by the matching flow are tagged with the opportunity, so this
 * is an exact check rather than a guess at the subject line. Used to keep the
 * repair route from sending a second copy.
 */
export async function findShortlistThread(
  ngoId: string,
  opportunityId: string
): Promise<string | null> {
  const thread = await prisma.reviewThread.findFirst({
    where: {
      subjectType: "NGO",
      subjectId: ngoId,
      entityType: "OPPORTUNITY",
      entityId: opportunityId,
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return thread?.id ?? null;
}

/**
 * Tell the funder that an organisation has been shortlisted for their
 * opportunity.
 *
 * One opportunity is one conversation: the first shortlisting opens a thread,
 * every later one appends to it. Five separate threads for five shortlists
 * under the same grant would read as five different opportunities.
 *
 * A funder is a User with role DONOR and a CSR/FOUNDATION/GOVERNMENT persona —
 * there is no funder role and no funder organisation. So this reaches ONE
 * person's account, not a team, and the two channels that actually land for
 * them are the bell and the email: donors have no inbox page yet, unlike
 * /ngo/inquiries. They can still be told; they just cannot reply in-app.
 *
 * @returns the thread id, or null when the opportunity has no linked funder
 * account (most funders are offline — funderName is only a display string).
 */
export async function notifyFunderOfShortlist(opts: {
  opportunityId: string;
  opportunityTitle: string;
  funderUserId: string;
  ngoName: string;
  adminId: string | null;
  request?: Request | null;
}): Promise<string | null> {
  const funder = await prisma.user.findUnique({
    where: { id: opts.funderUserId },
    select: { id: true, email: true, name: true, companyName: true },
  });
  if (!funder) return null;

  const subject = `Shortlist update: ${opts.opportunityTitle}`;
  const body = [
    `${opts.ngoName} has been shortlisted for "${opts.opportunityTitle}".`,
    ``,
    `The organisation met the criteria you set and has been told it is shortlisted. It has not been awarded anything, and no funds have been committed.`,
    ``,
    `You can review the full eligibility reasoning with the ImpactBridge team.`,
  ].join("\n");

  const shared: OpenThreadOptions = {
    subjectType: "DONOR",
    subjectId: funder.id,
    participantUserId: funder.id,
    recipientEmail: funder.email,
    recipientName: funder.companyName || funder.name || "there",
    adminId: opts.adminId,
    subject,
    body,
    entityType: "OPPORTUNITY",
    entityId: opts.opportunityId,
    notificationType: "OPPORTUNITY_SHORTLIST_UPDATE",
    notificationTitle: "An organisation was shortlisted for your opportunity",
    request: opts.request,
  };

  const existing = await prisma.reviewThread.findFirst({
    where: {
      subjectType: "DONOR",
      subjectId: funder.id,
      entityType: "OPPORTUNITY",
      entityId: opts.opportunityId,
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  return existing ? appendToThread(existing.id, shared) : openThread(shared);
}
