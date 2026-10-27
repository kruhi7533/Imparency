import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

/**
 * ADM-010 / NEG-005 — Razorpay webhook replay.
 *
 * The same signed `payment.captured` delivery is POSTed twice. The signature
 * is computed in-test with a test secret (HMAC-SHA256 over the raw body, as
 * Razorpay does). A stateful in-memory store stands in for Postgres — the
 * unique WebhookEvent.dedupeKey and the donation row — so "one effect" is
 * measured on the totals themselves, not on mock call counts alone.
 *
 * Covered: sequential replay, concurrent replay (both deliveries read the
 * donation as PENDING before either commits), and the missing-secret config
 * error.
 */

const store = vi.hoisted(() => ({
  dedupeKeys: new Set<string>(),
  donationStatus: "PENDING" as string,
  raised: 0,
  donorTotal: 0,
  ledger: 0,
}));

const db = vi.hoisted(() => ({
  donation: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn((a: any) => ({ op: "donation", a })) },
  project: { update: vi.fn((a: any) => ({ op: "project", a })) },
  user: { update: vi.fn((a: any) => ({ op: "user", a })) },
  nGOCompliance: { findUnique: vi.fn(async () => null) },
  webhookEvent: { create: vi.fn((a: any) => ({ op: "webhookEvent", a })) },
  ledgerEntry: { create: vi.fn((a: any) => ({ op: "ledger", a })) },
  milestone: { updateMany: vi.fn() },
  financeException: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  impactReport: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/email", () => ({ sendPaymentRetryEmail: vi.fn() }));
vi.mock("@/lib/tax-receipt", () => ({
  evaluateReceiptEligibility: vi.fn(() => ({ eligible: true })),
  issueTaxReceipt: vi.fn(),
  queueReceiptClaim: vi.fn(),
}));
vi.mock("@/lib/impact-events", () => ({ ensureImpactSubscription: vi.fn() }));
vi.mock("@/lib/ngo-compliance", () => ({
  hasVerifiedImpactProof: vi.fn(async () => true),
  computeCompliance: vi.fn(() => ({ score: 100, breakdown: {}, fcraBadge: "ACTIVE" })),
  deriveFcraStatus: vi.fn(() => "ACTIVE"),
}));

import { issueTaxReceipt } from "@/lib/tax-receipt";
import { POST } from "@/app/api/donations/webhook/route";

const TEST_SECRET = "whsec_test_replay_only";

const DONATION = {
  id: "don_1",
  amount: 1000,
  donorId: "user_1",
  projectId: "proj_1",
  retryCount: 0,
  milestoneIds: [],
  donor: { id: "user_1", email: "donor@example.test", name: "D", panStatus: "VERIFIED", panNumber: "ABCDE1234F", panVerifiedVia: "MANUAL", donorCategory: "INDIAN_IN_INDIA", nriSourceDeclaration: null },
  project: { id: "proj_1", title: "T", ngoId: "ngo_1", ngo: { id: "ngo_1", healthScore: 80 } },
};

/** One delivery body, signed once — a replay is byte-for-byte the same request. */
const BODY = JSON.stringify({
  id: "evt_replay_1",
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_replay_1", order_id: "order_replay_1", amount: 100000, currency: "INR", created_at: 1761500000 } } },
});
const SIGNATURE = crypto.createHmac("sha256", TEST_SECRET).update(BODY).digest("hex");
const delivery = () =>
  new Request("http://localhost/api/donations/webhook", { method: "POST", body: BODY, headers: { "x-razorpay-signature": SIGNATURE } });

/** Applies an array-form batch atomically against the store, like Postgres would. */
async function applyBatch(ops: Array<{ op: string; a: any }>) {
  const key = ops.find((o) => o.op === "webhookEvent")!.a.data.dedupeKey;
  if (store.dedupeKeys.has(key)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  store.dedupeKeys.add(key);
  for (const o of ops) {
    if (o.op === "project") store.raised += Number(o.a.data.raisedAmount.increment.toString());
    if (o.op === "user") store.donorTotal += Number(o.a.data.totalDonated.increment.toString());
    if (o.op === "ledger") store.ledger += 1;
    if (o.op === "donation") store.donationStatus = o.a.data.status;
  }
  return ops;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", TEST_SECRET);
  Object.assign(store, { dedupeKeys: new Set<string>(), donationStatus: "PENDING", raised: 0, donorTotal: 0, ledger: 0 });
  db.$transaction.mockImplementation(applyBatch as any);
  db.donation.findFirst.mockImplementation(async () => ({ ...DONATION, status: store.donationStatus }));
  db.donation.findUnique.mockImplementation(async () => ({ ...DONATION, status: store.donationStatus }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("ADM-010 — replaying a signed payment.captured delivery", () => {
  it("sequential replay: two 200s, one effect", async () => {
    const first = await POST(delivery());
    const second = await POST(delivery());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(store.raised).toBe(1000);
    expect(store.donorTotal).toBe(1000);
    expect(store.ledger).toBe(1);
    expect(store.donationStatus).toBe("SUCCESS");
    expect(issueTaxReceipt).toHaveBeenCalledTimes(1);
  });

  it("concurrent replay: both read PENDING, the unique dedupe key lets one apply", async () => {
    // Both deliveries see PENDING, as two in-flight requests would.
    db.donation.findFirst.mockImplementation(async () => ({ ...DONATION, status: "PENDING" }));
    const [a, b] = await Promise.all([POST(delivery()), POST(delivery())]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const bodies = await Promise.all([a.json(), b.json()]);
    expect(bodies.filter((x: any) => x.duplicate)).toHaveLength(1);
    expect(store.raised).toBe(1000);
    expect(store.ledger).toBe(1);
    expect(issueTaxReceipt).toHaveBeenCalledTimes(1);
  });

  it("a replay with a tampered body is refused before any effect", async () => {
    const tampered = new Request("http://localhost/api/donations/webhook", {
      method: "POST",
      body: BODY.replace("100000", "900000"),
      headers: { "x-razorpay-signature": SIGNATURE },
    });
    expect((await POST(tampered)).status).toBe(400);
    expect(store.raised).toBe(0);
  });

  it("RAZORPAY_WEBHOOK_SECRET unset → structured 503 config error, nothing processed, no crash", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    const res = await POST(delivery());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Payment webhook is not configured on this server.",
      code: "WEBHOOK_NOT_CONFIGURED",
      retryable: true,
    });
    expect(db.donation.findFirst).not.toHaveBeenCalled();
    expect(store.raised).toBe(0);
  });
});
