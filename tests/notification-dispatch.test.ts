import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * DON-018 / NEG-011 — channel preferences, fallback and the delivery log.
 *
 *  - WhatsApp off -> logged OPTED_OUT, the update falls back to email;
 *  - a provider that is not configured is PROVIDER_NOT_CONFIGURED, never SENT;
 *  - every attempt is a log row (channel, status, reason);
 *  - a FAILED send lands in the dead-letter queue;
 *  - re-firing the same event sends nothing twice;
 *  - preferences and the delivery log are the caller's own rows only.
 */

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  notificationPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  notificationDeliveryLog: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  deadLetter: { upsert: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/notification", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email", () => ({ sendImpactUpdateEmail: vi.fn().mockResolvedValue({ success: true }) }));

import { getServerSession } from "next-auth/next";
import { sendPushNotification } from "@/lib/notification";
import { sendImpactUpdateEmail } from "@/lib/email";
import { dispatchDonorNotification, retryDeliveryLog } from "@/lib/notification-dispatch";
import { GET as PREFS_GET, PATCH as PREFS_PATCH } from "@/app/api/donor/notification-preferences/route";
import { GET as DONOR_LOG } from "@/app/api/donor/notification-deliveries/route";
import { GET as ADMIN_LOG } from "@/app/api/admin/notification-deliveries/route";

const session = getServerSession as any;
const env = process.env as Record<string, string | undefined>;
const msg = { userId: "d1", eventKey: "milestone-completed:m1", topic: "PROJECT_UPDATE" as const, title: "Milestone completed", body: "Roof built" };
const logged = () => db.notificationDeliveryLog.create.mock.calls.map((c: any) => c[0].data);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.user.findUnique.mockResolvedValue({ id: "d1", name: "Priya", email: "priya@example.com", phone: "+919800000000", projectUpdatesOptOut: false });
  db.notificationPreference.findUnique.mockResolvedValue(null);
  db.notificationDeliveryLog.findMany.mockResolvedValue([]);
  db.notificationDeliveryLog.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `log-${data.channel}-${data.attempt}` }));
});
afterEach(() => {
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_NUMBER", "RESEND_API_KEY", "GMAIL_APP_PASSWORD"]) delete env[k];
  vi.unstubAllGlobals();
});

const configureWhatsApp = () => {
  env.TWILIO_ACCOUNT_SID = "AC1";
  env.TWILIO_AUTH_TOKEN = "tok";
  env.TWILIO_WHATSAPP_NUMBER = "+14155238886";
};

describe("fallback chain", () => {
  it("donor disables WhatsApp -> OPTED_OUT, falls back to email (SENT), in-app SENT", async () => {
    configureWhatsApp();
    env.RESEND_API_KEY = "k";
    db.notificationPreference.findUnique.mockResolvedValue({ userId: "d1", whatsapp: false, email: true, inApp: true });

    const results = await dispatchDonorNotification(msg);

    expect(results.map((r) => [r.channel, r.status])).toEqual([
      ["IN_APP", "SENT"],
      ["WHATSAPP", "OPTED_OUT"],
      ["EMAIL", "SENT"],
    ]);
    expect(fetchMock).not.toHaveBeenCalled(); // no WhatsApp send at all
    expect(sendImpactUpdateEmail).toHaveBeenCalledTimes(1);
    expect(logged()).toEqual([
      expect.objectContaining({ channel: "IN_APP", status: "SENT" }),
      expect.objectContaining({ channel: "WHATSAPP", status: "OPTED_OUT", reason: expect.stringContaining("switched off") }),
      expect.objectContaining({ channel: "EMAIL", status: "SENT", reason: expect.stringContaining("Fallback from WhatsApp (OPTED_OUT)") }),
    ]);
  });

  it("WhatsApp delivered -> no email is sent", async () => {
    configureWhatsApp();
    env.RESEND_API_KEY = "k";
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    const results = await dispatchDonorNotification(msg);
    expect(results.map((r) => r.channel)).toEqual(["IN_APP", "WHATSAPP"]);
    expect(sendImpactUpdateEmail).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toContain("api.twilio.com");
  });

  it("no providers configured -> PROVIDER_NOT_CONFIGURED for both external channels, in-app still delivered", async () => {
    const results = await dispatchDonorNotification(msg);
    expect(results.map((r) => [r.channel, r.status])).toEqual([
      ["IN_APP", "SENT"],
      ["WHATSAPP", "PROVIDER_NOT_CONFIGURED"],
      ["EMAIL", "PROVIDER_NOT_CONFIGURED"],
    ]);
    expect(sendImpactUpdateEmail).not.toHaveBeenCalled(); // a console "mock" email is not a delivery
  });

  it("a failed WhatsApp send is FAILED, lands in the dead-letter queue, and falls back to email", async () => {
    configureWhatsApp();
    env.RESEND_API_KEY = "k";
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const results = await dispatchDonorNotification(msg);
    expect(results.find((r) => r.channel === "WHATSAPP")).toMatchObject({ status: "FAILED", reason: "Twilio HTTP 500" });
    expect(results.find((r) => r.channel === "EMAIL")?.status).toBe("SENT");
    expect(db.deadLetter.upsert).toHaveBeenCalledTimes(1);
    expect(db.deadLetter.upsert.mock.calls[0][0].create).toMatchObject({
      kind: "NOTIFICATION_DELIVERY",
      sourceId: "log-WHATSAPP-1",
      refs: { deliveryLogId: "log-WHATSAPP-1", userId: "d1", channel: "WHATSAPP", eventKey: msg.eventKey },
    });
    // ids only — no phone or email in the queue
    expect(JSON.stringify(db.deadLetter.upsert.mock.calls[0][0])).not.toMatch(/\+91|@/);
  });

  it("project updates switched off -> every channel OPTED_OUT, nothing sent", async () => {
    db.user.findUnique.mockResolvedValue({ id: "d1", name: "P", email: "p@example.com", phone: null, projectUpdatesOptOut: true });
    const results = await dispatchDonorNotification(msg);
    expect(results.every((r) => r.status === "OPTED_OUT")).toBe(true);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("re-firing the same event sends nothing twice", async () => {
    db.notificationDeliveryLog.findMany.mockResolvedValue([
      { id: "l1", channel: "IN_APP", status: "SENT", reason: null, attempt: 1 },
      { id: "l2", channel: "WHATSAPP", status: "PROVIDER_NOT_CONFIGURED", reason: "x", attempt: 1 },
      { id: "l3", channel: "EMAIL", status: "PROVIDER_NOT_CONFIGURED", reason: "y", attempt: 1 },
    ]);
    const results = await dispatchDonorNotification(msg);
    expect(results.every((r) => r.duplicate)).toBe(true);
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(db.notificationDeliveryLog.create).not.toHaveBeenCalled();
  });
});

describe("retry of a FAILED delivery (dead-letter replay)", () => {
  it("re-attempts the channel as attempt n+1", async () => {
    env.RESEND_API_KEY = "k";
    db.notificationDeliveryLog.findUnique.mockResolvedValue({ id: "l9", userId: "d1", eventKey: "e", topic: "PROJECT_UPDATE", channel: "EMAIL", status: "FAILED", attempt: 1, title: "T", body: "B" });
    db.notificationDeliveryLog.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ attempt: 1 });
    const out = await retryDeliveryLog("l9");
    expect(out).toMatchObject({ channel: "EMAIL", attempt: 2, status: "SENT" });
    expect(logged()[0]).toMatchObject({ attempt: 2, status: "SENT", reason: "Replay" });
  });

  it("does not resend a channel that has since been delivered", async () => {
    db.notificationDeliveryLog.findUnique.mockResolvedValue({ id: "l9", userId: "d1", eventKey: "e", topic: "PROJECT_UPDATE", channel: "EMAIL", status: "FAILED", attempt: 1, title: "T", body: "B" });
    db.notificationDeliveryLog.findFirst.mockResolvedValueOnce({ attempt: 2 });
    expect(await retryDeliveryLog("l9")).toMatchObject({ status: "SENT", reason: "Already delivered." });
    expect(sendImpactUpdateEmail).not.toHaveBeenCalled();
  });
});

describe("preferences and delivery log routes", () => {
  const patch = (body: unknown) =>
    PREFS_PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

  it("a donor turns WhatsApp off on their OWN row only", async () => {
    session.mockResolvedValue({ user: { id: "d1", role: "DONOR" } });
    db.user.findUnique.mockResolvedValue({ projectUpdatesOptOut: false });
    db.notificationPreference.findUnique.mockResolvedValue({ userId: "d1", whatsapp: false, email: true, inApp: true });
    const res = await patch({ channels: { whatsapp: false } });
    expect(res.status).toBe(200);
    expect(db.notificationPreference.upsert.mock.calls[0][0]).toMatchObject({ where: { userId: "d1" }, update: { whatsapp: false } });
    expect((await res.json()).channels).toEqual({ whatsapp: false, email: true, inApp: true });
  });

  it("rejects non-boolean channel values and empty bodies", async () => {
    session.mockResolvedValue({ user: { id: "d1", role: "DONOR" } });
    expect((await patch({ channels: { whatsapp: "no" } })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("an NGO cannot read or write donor preferences", async () => {
    session.mockResolvedValue({ user: { id: "n1", role: "NGO" } });
    expect((await PREFS_GET()).status).toBe(403);
    expect((await patch({ channels: { email: false } })).status).toBe(403);
  });

  it("the donor delivery log is scoped to the caller", async () => {
    session.mockResolvedValue({ user: { id: "d1", role: "DONOR" } });
    db.notificationDeliveryLog.findMany.mockResolvedValue([]);
    const res = await DONOR_LOG(new Request("http://test/api/donor/notification-deliveries?userId=d2"));
    expect(res.status).toBe(200);
    expect(db.notificationDeliveryLog.findMany.mock.calls[0][0].where).toEqual({ userId: "d1" });
  });

  it("the admin delivery log is admin-only and filterable", async () => {
    session.mockResolvedValue({ user: { id: "d1", role: "DONOR" } });
    expect((await ADMIN_LOG(new Request("http://test/api/admin/notification-deliveries"))).status).toBe(403);
    session.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    db.notificationDeliveryLog.findMany.mockResolvedValue([]);
    await ADMIN_LOG(new Request("http://test/api/admin/notification-deliveries?status=opted_out&channel=whatsapp"));
    expect(db.notificationDeliveryLog.findMany.mock.calls[0][0].where).toEqual({ status: "OPTED_OUT", channel: "WHATSAPP" });
  });
});
