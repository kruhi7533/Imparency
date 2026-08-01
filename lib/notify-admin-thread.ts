import prisma from "@/lib/prisma";
import { getBoolSetting, SETTING_KEYS } from "@/lib/app-settings";
import { sendAdminNgoReplyEmail } from "@/lib/email";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "inkvuex@gmail.com";

/**
 * Notify admins that an NGO has written on a review thread — a reply or a new
 * appeal. This is the missing mirror of the admin→NGO notification the admin
 * reply route already sends, so an NGO message never lands silently in the
 * Inquiries queue.
 *
 * Always creates an in-app Notification for every admin; additionally emails
 * ADMIN_EMAIL only when the EMAIL_ON_NGO_REPLY toggle is on.
 *
 * Best-effort: never throws — a mail/notification failure must not fail the
 * NGO's reply (mirrors logAdminAction). Failures are logged loudly instead.
 */
export async function notifyAdminsOfNgoThreadActivity(opts: {
  ngoId: string;
  threadSubject: string;
  kind: string; // "INQUIRY" | "APPEAL"
  body: string;
}): Promise<void> {
  try {
    // The setting read has no dependency on the NGO/admin lookups — fetch all
    // three concurrently so this sits on the request path for one round-trip,
    // not three.
    const [ngo, admins, emailOn] = await Promise.all([
      prisma.nGOProfile.findUnique({
        where: { id: opts.ngoId },
        select: { orgName: true },
      }),
      prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }),
      getBoolSetting(SETTING_KEYS.EMAIL_ON_NGO_REPLY, true),
    ]);

    const orgName = ngo?.orgName ?? "An NGO";
    const preview = opts.body.slice(0, 180) + (opts.body.length > 180 ? "…" : "");
    const label = opts.kind === "APPEAL" ? "appeal" : "inquiry";

    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: "NGO_THREAD_REPLY",
          title: `${orgName} responded on an ${label}`,
          body: `"${opts.threadSubject}": ${preview}`,
        })),
      });
    }

    if (emailOn) {
      await sendAdminNgoReplyEmail(ADMIN_EMAIL, orgName, opts.threadSubject, opts.kind, preview);
    }
  } catch (err) {
    console.error("[notify-admin-thread] failed to notify admins of NGO thread activity:", err);
  }
}
