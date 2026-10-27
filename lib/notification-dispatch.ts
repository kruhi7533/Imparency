import prisma from "@/lib/prisma";
import { sendPushNotification } from "@/lib/notification";
import { recordDeadLetter } from "@/lib/dead-letter";

/**
 * Donor notification dispatch with channel preferences, fallback and a
 * delivery log (DON-018 / NEG-011). Server only.
 *
 * Channel order for one message:
 *   IN_APP    the floor — always attempted when the donor has it on.
 *   WHATSAPP  the preferred external channel.
 *   EMAIL     the fallback: attempted only when WhatsApp did not send
 *             (opted out, provider not configured, no number, or failed).
 *
 * EVERY attempt — including one that was never made because the donor opted
 * out or the provider is not configured — is a NotificationDeliveryLog row
 * with status SENT / FAILED / OPTED_OUT / PROVIDER_NOT_CONFIGURED and a reason,
 * so "why didn't I get a WhatsApp?" has an answer on both the donor's and the
 * admin's screen. A FAILED attempt also lands in the dead-letter queue.
 *
 * Idempotent per (user, eventKey, channel): re-firing the same event sends
 * nothing twice (@@unique(userId, eventKey, channel, attempt) + a pre-check).
 * The log carries the message title/body (the same text the Notification table
 * holds) so a failure can be replayed; never an email address or phone number.
 */

export type Channel = "IN_APP" | "WHATSAPP" | "EMAIL";
export type DeliveryStatus = "SENT" | "FAILED" | "OPTED_OUT" | "PROVIDER_NOT_CONFIGURED";
export type NotificationTopic = "PROJECT_UPDATE";

export interface ChannelPreferences {
  whatsapp: boolean;
  email: boolean;
  inApp: boolean;
}
export const DEFAULT_PREFERENCES: ChannelPreferences = { whatsapp: true, email: true, inApp: true };

export async function getChannelPreferences(userId: string): Promise<ChannelPreferences> {
  try {
    const row = await prisma.notificationPreference.findUnique({ where: { userId } });
    return row ? { whatsapp: row.whatsapp, email: row.email, inApp: row.inApp } : { ...DEFAULT_PREFERENCES };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function whatsappConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER);
}

export function emailConfigured(): boolean {
  // lib/email.ts falls back to a console "mock" when neither is set — that is
  // not a delivery, so it is reported as PROVIDER_NOT_CONFIGURED, not SENT.
  return !!(process.env.GMAIL_APP_PASSWORD || process.env.RESEND_API_KEY);
}

export interface ChannelResult {
  channel: Channel;
  status: DeliveryStatus;
  reason: string | null;
  attempt: number;
  logId: string | null;
  /** True when an earlier dispatch of the same event already covered this channel. */
  duplicate?: boolean;
}

interface Recipient {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  projectUpdatesOptOut: boolean;
}

export interface DispatchMessage {
  userId: string;
  /** Stable id of the event, e.g. "milestone-completed:<milestoneId>". */
  eventKey: string;
  topic: NotificationTopic;
  title: string;
  body: string;
  /** In-app deep link. */
  link?: string;
  /** Extra push payload (ids only). */
  data?: Record<string, string>;
  projectTitle?: string;
  /** Custom email for this message (e.g. the milestone email with its narrative). */
  emailSender?: (to: string, name: string) => Promise<{ success: boolean; error?: string }>;
}

/** Twilio WhatsApp send over REST (no SDK). Throws on a non-2xx. */
async function sendWhatsApp(toPhone: string, text: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_NUMBER!;
  const to = toPhone.startsWith("whatsapp:") ? toPhone : `whatsapp:${toPhone}`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`, To: to, Body: text.slice(0, 1500) }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
}

async function sendEmailMessage(r: Recipient, msg: DispatchMessage): Promise<void> {
  if (msg.emailSender) {
    const custom = await msg.emailSender(r.email!, r.name ?? "there");
    if (!custom.success) throw new Error(custom.error || "Email send failed");
    return;
  }
  const { sendImpactUpdateEmail } = await import("@/lib/email");
  const result = await sendImpactUpdateEmail(r.email!, r.name ?? "there", msg.projectTitle ?? "a project you fund", msg.title, msg.body);
  if (!result.success) throw new Error((result as any).error || "Email send failed");
}

/** Attempt one channel. Decides OPTED_OUT / PROVIDER_NOT_CONFIGURED before sending. */
async function attempt(
  channel: Channel,
  r: Recipient,
  prefs: ChannelPreferences,
  msg: DispatchMessage
): Promise<{ status: DeliveryStatus; reason: string | null }> {
  if (msg.topic === "PROJECT_UPDATE" && r.projectUpdatesOptOut) {
    return { status: "OPTED_OUT", reason: "Project update notifications are switched off." };
  }
  try {
    if (channel === "IN_APP") {
      if (!prefs.inApp) return { status: "OPTED_OUT", reason: "In-app notifications are switched off." };
      const data = { ...(msg.data ?? {}), ...(msg.link ? { link: msg.link } : {}) };
      await sendPushNotification(msg.userId, msg.title, msg.body, Object.keys(data).length ? data : undefined);
      return { status: "SENT", reason: null };
    }
    if (channel === "WHATSAPP") {
      if (!prefs.whatsapp) return { status: "OPTED_OUT", reason: "WhatsApp is switched off in your preferences." };
      if (!whatsappConfigured()) return { status: "PROVIDER_NOT_CONFIGURED", reason: "WhatsApp provider (Twilio) is not configured on this server." };
      if (!r.phone) return { status: "PROVIDER_NOT_CONFIGURED", reason: "No WhatsApp number on file." };
      await sendWhatsApp(r.phone, `${msg.title}\n\n${msg.body}`);
      return { status: "SENT", reason: null };
    }
    if (!prefs.email) return { status: "OPTED_OUT", reason: "Email is switched off in your preferences." };
    if (!emailConfigured()) return { status: "PROVIDER_NOT_CONFIGURED", reason: "Email provider is not configured on this server." };
    if (!r.email) return { status: "PROVIDER_NOT_CONFIGURED", reason: "No email address on file." };
    await sendEmailMessage(r, msg);
    return { status: "SENT", reason: null };
  } catch (err) {
    return { status: "FAILED", reason: String((err as Error)?.message ?? err).slice(0, 300) };
  }
}

async function writeLog(
  msg: DispatchMessage,
  channel: Channel,
  attemptNo: number,
  outcome: { status: DeliveryStatus; reason: string | null }
): Promise<string | null> {
  try {
    const row = await prisma.notificationDeliveryLog.create({
      data: {
        userId: msg.userId,
        eventKey: msg.eventKey,
        topic: msg.topic,
        channel,
        status: outcome.status,
        reason: outcome.reason,
        attempt: attemptNo,
        title: msg.title.slice(0, 300),
        body: msg.body.slice(0, 2000),
      },
      select: { id: true },
    });
    if (outcome.status === "FAILED") {
      await recordDeadLetter({
        kind: "NOTIFICATION_DELIVERY",
        sourceId: row.id,
        refs: { deliveryLogId: row.id, userId: msg.userId, channel, eventKey: msg.eventKey },
        errorMessage: outcome.reason,
        attempts: attemptNo,
      });
    }
    return row.id;
  } catch (err: any) {
    if (err?.code !== "P2002") console.error("[notification-dispatch] could not write delivery log:", err?.message ?? err);
    return null;
  }
}

async function loadRecipient(userId: string): Promise<Recipient | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, phone: true, projectUpdatesOptOut: true },
  });
}

/** Deliver one message to one donor across channels. Never throws. */
export async function dispatchDonorNotification(msg: DispatchMessage): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];
  let recipient: Recipient | null = null;
  try {
    recipient = await loadRecipient(msg.userId);
  } catch (err) {
    console.error("[notification-dispatch] could not load recipient:", (err as Error)?.message);
  }
  if (!recipient) return results;
  const prefs = await getChannelPreferences(msg.userId);

  // Channels this event already covered (a re-fired event sends nothing twice).
  let prior: Array<{ channel: string; status: string; reason: string | null; attempt: number; id: string }> = [];
  try {
    prior = await prisma.notificationDeliveryLog.findMany({
      where: { userId: msg.userId, eventKey: msg.eventKey },
      select: { channel: true, status: true, reason: true, attempt: true, id: true },
      orderBy: { attempt: "desc" },
    });
  } catch {
    prior = [];
  }
  const run = async (channel: Channel, reasonPrefix?: string): Promise<ChannelResult> => {
    const before = prior.find((p) => p.channel === channel);
    if (before) {
      return { channel, status: before.status as DeliveryStatus, reason: before.reason, attempt: before.attempt, logId: before.id, duplicate: true };
    }
    const outcome = await attempt(channel, recipient!, prefs, msg);
    if (reasonPrefix) outcome.reason = outcome.reason ? `${reasonPrefix} ${outcome.reason}` : reasonPrefix;
    const logId = await writeLog(msg, channel, 1, outcome);
    return { channel, ...outcome, attempt: 1, logId };
  };

  results.push(await run("IN_APP"));
  const wa = await run("WHATSAPP");
  results.push(wa);
  if (wa.status !== "SENT") {
    results.push(await run("EMAIL", `Fallback from WhatsApp (${wa.status}).`));
  }
  return results;
}

/** One more attempt at a FAILED log row's channel (dead-letter replay). Respects current preferences. */
export async function retryDeliveryLog(logId: string): Promise<{ channel: Channel; attempt: number; status: DeliveryStatus; reason: string | null }> {
  const log = await prisma.notificationDeliveryLog.findUnique({ where: { id: logId } });
  if (!log) throw new Error("Delivery log row not found.");
  const channel = log.channel as Channel;
  const sent = await prisma.notificationDeliveryLog.findFirst({
    where: { userId: log.userId, eventKey: log.eventKey, channel: log.channel, status: "SENT" },
    select: { attempt: true },
  });
  if (sent) return { channel, attempt: sent.attempt, status: "SENT", reason: "Already delivered." };
  const recipient = await loadRecipient(log.userId);
  if (!recipient) throw new Error("Recipient no longer exists.");
  const latest = await prisma.notificationDeliveryLog.findFirst({
    where: { userId: log.userId, eventKey: log.eventKey, channel: log.channel },
    orderBy: { attempt: "desc" },
    select: { attempt: true },
  });
  const attemptNo = (latest?.attempt ?? log.attempt) + 1;
  const msg: DispatchMessage = { userId: log.userId, eventKey: log.eventKey, topic: log.topic as NotificationTopic, title: log.title, body: log.body };
  const outcome = await attempt(channel, recipient, await getChannelPreferences(log.userId), msg);
  const reason = outcome.reason ? `Replay: ${outcome.reason}` : "Replay";
  // A failed replay is not re-queued: the dead-letter row it came from records the outcome.
  try {
    await prisma.notificationDeliveryLog.create({
      data: { userId: log.userId, eventKey: log.eventKey, topic: log.topic, channel: log.channel, status: outcome.status, reason, attempt: attemptNo, title: log.title, body: log.body },
    });
  } catch (err: any) {
    if (err?.code === "P2002") throw new Error("A concurrent retry already ran.");
    throw err;
  }
  return { channel, attempt: attemptNo, status: outcome.status, reason };
}
