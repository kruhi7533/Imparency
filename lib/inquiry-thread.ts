import prisma from "@/lib/prisma";
import { sendAdminInquiryEmail } from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";

/**
 * Opening (or continuing) a thread with someone outside the console.
 *
 * Telling a party something is three writes, not one — a ReviewThread they can
 * reply on, a Notification for their bell, and an email. Miss any and the
 * message half-arrives: an email with nowhere to reply, or a thread nobody is
 * told about.
 *
 * ReviewThread.subjectType has always supported "NGO" | "DONOR", and
 * /admin/inquiries already renders both. Only the NGO half had a helper, so
 * this generalises it rather than growing a second, subtly different copy for
 * funders.
 *
 * One asymmetry to be aware of: NGOs have an inbox at /ngo/inquiries and can
 * reply in-app. Donors have no such page yet, so for them the bell and the
 * email are the channels that actually land — the thread is where the admin
 * sees their side of the conversation.
 */

export type ThreadSubjectType = "NGO" | "DONOR";

export interface OpenThreadOptions {
  subjectType: ThreadSubjectType;
  /** NGOProfile.id for an NGO thread, User.id for a donor thread. */
  subjectId: string;
  /** The user who is notified and who may reply. */
  participantUserId: string;
  /** Where the email goes. */
  recipientEmail: string;
  /** Display name used in the email greeting. */
  recipientName: string;
  /** Acting admin, or null when the platform itself is speaking. */
  adminId: string | null;
  subject: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  notificationType?: string;
  notificationTitle?: string;
  request?: Request | null;
}

/**
 * Create a thread, notify, and email.
 *
 * @throws if the thread cannot be written — it is the source of truth, so a
 * caller that needs the message to have landed can rely on this. Only the email
 * is best-effort.
 */
export async function openThread(opts: OpenThreadOptions): Promise<string> {
  const subject = opts.subject.trim();
  const body = opts.body.trim();

  const thread = await prisma.reviewThread.create({
    data: {
      subjectType: opts.subjectType,
      subjectId: opts.subjectId,
      participantUserId: opts.participantUserId,
      kind: "INQUIRY",
      subject,
      entityType: opts.entityType || null,
      entityId: opts.entityId || null,
      status: "OPEN",
      createdById: opts.adminId ?? opts.participantUserId,
      messages: {
        create: {
          authorId: opts.adminId ?? opts.participantUserId,
          authorRole: "ADMIN",
          body,
        },
      },
    },
    select: { id: true },
  });

  await notifyAndEmail(thread.id, opts, subject, body);
  return thread.id;
}

/**
 * Add to an existing thread instead of starting another one.
 *
 * A funder shortlisting five organisations under one opportunity should get one
 * conversation with five updates, not five conversations.
 */
export async function appendToThread(
  threadId: string,
  opts: OpenThreadOptions
): Promise<string> {
  const subject = opts.subject.trim();
  const body = opts.body.trim();

  await prisma.reviewMessage.create({
    data: {
      threadId,
      authorId: opts.adminId ?? opts.participantUserId,
      authorRole: "ADMIN",
      body,
    },
  });
  // Surface it again in the admin's "waiting on a reply" ordering.
  await prisma.reviewThread.update({
    where: { id: threadId },
    data: { status: "OPEN", updatedAt: new Date() },
  });

  await notifyAndEmail(threadId, opts, subject, body);
  return threadId;
}

async function notifyAndEmail(
  threadId: string,
  opts: OpenThreadOptions,
  subject: string,
  body: string
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: opts.participantUserId,
      type: opts.notificationType ?? "ADMIN_INQUIRY",
      title: opts.notificationTitle ?? "You have a new message from ImpactBridge",
      body: `${subject}: ${body.slice(0, 180)}${body.length > 180 ? "…" : ""}`,
    },
  });

  await logAdminAction({
    adminId: opts.adminId,
    action: "NGO_INQUIRY_SENT",
    entityType: "THREAD",
    entityId: threadId,
    note: body,
    metadata: {
      subjectType: opts.subjectType,
      subjectId: opts.subjectId,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
    },
    request: opts.request ?? null,
  });

  // Best-effort: the thread is the source of truth, and a dead mail provider
  // must not undo a message the recipient can already see in the console.
  try {
    await sendAdminInquiryEmail(opts.recipientEmail, opts.recipientName, subject, body);
  } catch (emailErr) {
    console.error("inquiry email failed (thread still created):", emailErr);
  }
}

/**
 * Thin wrapper for the common case: a thread with an organisation, resolved
 * from its NGOProfile id.
 */
export async function openNgoInquiryThread(opts: {
  ngoId: string;
  adminId: string | null;
  subject: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  notificationType?: string;
  notificationTitle?: string;
  request?: Request | null;
}): Promise<string> {
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: opts.ngoId },
    select: { id: true, orgName: true, user: { select: { id: true, email: true } } },
  });
  if (!ngo) throw new Error("NGO not found");

  return openThread({
    subjectType: "NGO",
    subjectId: ngo.id,
    participantUserId: ngo.user.id,
    recipientEmail: ngo.user.email,
    recipientName: ngo.orgName,
    adminId: opts.adminId,
    subject: opts.subject,
    body: opts.body,
    entityType: opts.entityType,
    entityId: opts.entityId,
    notificationType: opts.notificationType ?? "ADMIN_INQUIRY",
    notificationTitle:
      opts.notificationTitle ?? "Admin has a question for your organisation",
    request: opts.request,
  });
}
