import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Donor re-engagement, now a daily cron instead of a webhook setTimeout.
 * Idempotency (a re-run or repeat request sends nothing twice), opt-out, the
 * due-report window, and the cron's auth and one-nudge-per-donor rule.
 */

const db = vi.hoisted(() => ({
  reEngagementEvent: { findFirst: vi.fn(), create: vi.fn() },
  impactReport: { findUnique: vi.fn(), findMany: vi.fn() },
  donation: { count: vi.fn(), findMany: vi.fn() },
  user: { update: vi.fn() },
  nGOProfile: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
const mail = vi.hoisted(() => ({
  sendTierUpgradeEmail: vi.fn(),
  sendNGOReferralEmail: vi.fn(),
  sendGrantModeEmail: vi.fn(),
  sendVolunteerEmail: vi.fn(),
}));
vi.mock("@/lib/email", () => mail);
vi.mock("@/lib/job-runner", () => ({
  runJob: vi.fn(async (_n: string, _o: unknown, fn: any) => ({ skipped: false, value: await fn({ recordItems: vi.fn() }) })),
}));

import { findDueReports, reEngage, RE_ENGAGE_AFTER_MS } from "@/lib/re-engagement";
import { GET as CRON } from "@/app/api/cron/re-engagement/route";

const report = (over: any = {}) => ({
  id: "rep-1",
  donorId: "donor-1",
  donor: { id: "donor-1", email: "d@example.com", name: "D", totalDonated: 5000, donorTier: "STANDARD", donorPersona: null, volunteerInterest: false, projectUpdatesOptOut: false, ...over.donor },
  donation: { project: { ngo: { orgName: "Akshar", causeCategories: ["Education"] } } },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret-123";
  db.reEngagementEvent.findFirst.mockResolvedValue(null);
  db.reEngagementEvent.create.mockResolvedValue({ id: "evt-1" });
  db.impactReport.findUnique.mockResolvedValue(report());
  db.donation.count.mockResolvedValue(1);
  db.donation.findMany.mockResolvedValue([]);
});

describe("reEngage", () => {
  it("creates one event and sends one email", async () => {
    const r = await reEngage({ reportId: "rep-1", donorId: "donor-1" });
    expect(r.status).toBe("created");
    expect(db.reEngagementEvent.create).toHaveBeenCalledTimes(1);
    const sent = Object.values(mail).reduce((n, f: any) => n + f.mock.calls.length, 0);
    expect(sent).toBeLessThanOrEqual(1);
  });

  it("is idempotent per report: a second call creates nothing and emails nobody", async () => {
    db.reEngagementEvent.findFirst.mockResolvedValue({ id: "evt-1" });
    expect(await reEngage({ reportId: "rep-1", donorId: "donor-1" })).toEqual({ status: "exists", eventId: "evt-1" });
    expect(db.reEngagementEvent.create).not.toHaveBeenCalled();
    expect(Object.values(mail).every((f: any) => f.mock.calls.length === 0)).toBe(true);
  });

  it("someone else's report is not_found; an opted-out donor is never emailed", async () => {
    expect((await reEngage({ reportId: "rep-1", donorId: "donor-2" })).status).toBe("not_found");
    db.impactReport.findUnique.mockResolvedValue(report({ donor: { projectUpdatesOptOut: true } }));
    expect((await reEngage({ reportId: "rep-1", donorId: "donor-1" })).status).toBe("opted_out");
    expect(db.reEngagementEvent.create).not.toHaveBeenCalled();
  });

  it("a mail failure does not lose the event (the dashboard card still shows it)", async () => {
    Object.values(mail).forEach((f: any) => f.mockRejectedValue(new Error("smtp down")));
    expect((await reEngage({ reportId: "rep-1", donorId: "donor-1" })).status).toBe("created");
  });
});

describe("findDueReports", () => {
  it("looks only at reports 48h–14d old, on successful donations, for donors not opted out or recently nudged", async () => {
    db.impactReport.findMany.mockResolvedValue([]);
    const now = new Date("2026-10-21T00:00:00Z");
    await findDueReports(now);
    const where = db.impactReport.findMany.mock.calls[0][0].where;
    expect(where.sentAt.lte).toEqual(new Date(now.getTime() - RE_ENGAGE_AFTER_MS));
    expect(where.donation).toEqual({ status: "SUCCESS" });
    expect(where.donor.projectUpdatesOptOut).toBe(false);
    expect(where.donor.reEngagementEvents.none.emailSentAt.gte).toBeInstanceOf(Date);
  });
});

describe("GET /api/cron/re-engagement", () => {
  const call = (secret?: string) => CRON(new Request("http://localhost", { headers: secret ? { "x-cron-secret": secret } : {} }));

  it("refuses without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("wrong-secret-12")).status).toBe(401);
  });

  it("nudges each donor at most once per run", async () => {
    db.impactReport.findMany.mockResolvedValue([
      { id: "rep-1", donorId: "donor-1" },
      { id: "rep-2", donorId: "donor-1" },
    ]);
    const body = await (await call("cron-secret-123")).json();
    expect(body).toMatchObject({ due: 2, created: 1, skipped: 1 });
    expect(db.reEngagementEvent.create).toHaveBeenCalledTimes(1);
  });
});
