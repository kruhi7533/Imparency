import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/prisma", () => ({
  default: {
    donation: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    project: { update: vi.fn() },
    user: { update: vi.fn() },
    nGOCompliance: { findUnique: vi.fn() },
    webhookEvent: { create: vi.fn() },
    impactReport: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/email", () => ({
  sendPaymentRetryEmail: vi.fn(),
}));
vi.mock("@/lib/tax-receipt", () => ({
  evaluateReceiptEligibility: vi.fn(() => ({ eligible: true })),
  issueTaxReceipt: vi.fn(),
  queueReceiptClaim: vi.fn(),
}));
vi.mock("@/lib/impact-events", () => ({
  ensureImpactSubscription: vi.fn(),
}));
vi.mock("@/lib/ngo-compliance", () => ({
  hasVerifiedImpactProof: vi.fn(async () => true),
  computeCompliance: vi.fn(() => ({
    score: 100,
    breakdown: {},
    fcraBadge: "ACTIVE",
  })),
  deriveFcraStatus: vi.fn(() => "ACTIVE"),
}));

import prisma from "@/lib/prisma";
import { sendPaymentRetryEmail } from "@/lib/email";
import {
  evaluateReceiptEligibility,
  issueTaxReceipt,
  queueReceiptClaim,
} from "@/lib/tax-receipt";
import { POST } from "@/app/api/donations/webhook/route";
import { webhookDedupeKey, isUniqueConstraintError } from "@/lib/razorpay-webhook";

const SECRET = "test-webhook-secret";

function signedRequest(payload: unknown, secret = SECRET): Request {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return new Request("http://localhost/api/donations/webhook", {
    method: "POST",
    body,
    headers: { "x-razorpay-signature": signature },
  });
}

function capturedEvent(orderId = "order_123", paymentId = "pay_123") {
  return {
    event: "payment.captured",
    payload: { payment: { entity: { order_id: orderId, id: paymentId } } },
  };
}

function failedEvent(orderId = "order_123") {
  return {
    event: "payment.failed",
    payload: { payment: { entity: { order_id: orderId } } },
  };
}

const baseDonation = {
  id: "don_1",
  status: "PENDING",
  amount: 500,
  donorId: "user_1",
  projectId: "proj_1",
  retryCount: 0,
  donor: {
    id: "user_1",
    email: "donor@example.com",
    name: "Donor",
    panStatus: "VERIFIED",
    panNumber: "ABCDE1234F",
    panVerifiedVia: "MANUAL",
    donorCategory: "INDIAN_IN_INDIA",
    nriSourceDeclaration: null,
  },
  project: {
    id: "proj_1",
    title: "Clean Water",
    ngoId: "ngo_1",
    ngo: { id: "ngo_1", healthScore: 80 },
  },
};

const mocked = vi.mocked;

beforeEach(() => {
  vi.clearAllMocks();
  // Fake timers keep the handler's 48h/30s setTimeout callbacks from running.
  vi.useFakeTimers();
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
  mocked(prisma.$transaction).mockResolvedValue([] as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("webhook signature verification", () => {
  it("returns 500 when the webhook secret is not configured", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    const res = await POST(signedRequest(capturedEvent()));
    expect(res.status).toBe(500);
  });

  it("rejects a request signed with the wrong secret", async () => {
    const res = await POST(signedRequest(capturedEvent(), "wrong-secret"));
    expect(res.status).toBe(400);
    expect(prisma.donation.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature header", async () => {
    const res = await POST(
      new Request("http://localhost/api/donations/webhook", {
        method: "POST",
        body: JSON.stringify(capturedEvent()),
      })
    );
    expect(res.status).toBe(400);
  });

  it("accepts a correctly signed request", async () => {
    const res = await POST(signedRequest({ event: "irrelevant.event" }));
    expect(res.status).toBe(200);
  });
});

describe("payment.captured", () => {
  it("acknowledges unknown orders without touching the database", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue(null as never);

    const res = await POST(signedRequest(capturedEvent("order_unknown")));

    expect(res.status).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-SUCCESS donation is not processed again", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue({
      ...baseDonation,
      status: "SUCCESS",
    } as never);

    const res = await POST(signedRequest(capturedEvent()));

    expect(res.status).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(issueTaxReceipt).not.toHaveBeenCalled();
  });

  it("marks the donation SUCCESS and increments totals in one transaction", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue(baseDonation as never);
    mocked(prisma.nGOCompliance.findUnique).mockResolvedValue(null as never);
    mocked(prisma.donation.findUnique).mockResolvedValue(baseDonation as never);

    const res = await POST(signedRequest(capturedEvent("order_123", "pay_999")));

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.donation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "don_1" },
        data: expect.objectContaining({
          status: "SUCCESS",
          razorpayPaymentId: "pay_999",
        }),
      })
    );
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj_1" },
      data: { raisedAmount: { increment: 500 } },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { totalDonated: { increment: 500 } },
    });
  });

  /**
   * The sequential-replay test above passes purely on the `donation.status`
   * fast path. These cover the case that guard CANNOT catch: two deliveries of
   * the same payment in flight at once, both reading status PENDING before
   * either writes. Razorpay does retry, so this is a real delivery pattern and
   * not a theoretical one.
   *
   * Both increments are relative, so a double-apply inflates a project's
   * raised total and a donor's lifetime giving with no failing write anywhere
   * to notice it. The unique `WebhookEvent.dedupeKey` inside the transaction is
   * the only thing that makes the loser roll back.
   */
  it("records the payment in the same transaction that moves the money", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue(baseDonation as never);
    mocked(prisma.nGOCompliance.findUnique).mockResolvedValue(null as never);
    mocked(prisma.donation.findUnique).mockResolvedValue(baseDonation as never);

    await POST(signedRequest(capturedEvent("order_123", "pay_999")));

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "payment.captured",
        dedupeKey: "razorpay:payment.captured:pay_999",
        payloadId: "pay_999",
      }),
    });
    // Not merely called — it has to be INSIDE the batch. Built outside and
    // awaited separately, it would commit on its own and stop protecting the
    // increments.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // $transaction is overloaded (array batch | interactive callback), so the
    // cast has to go through unknown. The assertion below is the point: this
    // route must use the ARRAY form.
    const batch = mocked(prisma.$transaction).mock.calls[0][0] as unknown as unknown[];
    expect(batch).toHaveLength(4);
  });

  it("acknowledges without re-applying when a concurrent delivery already won the race", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue(baseDonation as never);
    mocked(prisma.nGOCompliance.findUnique).mockResolvedValue(null as never);
    // The loser of the race: the row was PENDING when it was read, so the fast
    // path let it through, and the unique dedupeKey is what stops it.
    mocked(prisma.$transaction).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }) as never
    );

    const res = await POST(signedRequest(capturedEvent("order_123", "pay_999")));

    // 200, not 5xx: the payment IS recorded, by the delivery that won. A 5xx
    // would have Razorpay redeliver a correctly-recorded payment forever.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ duplicate: true });
    // Nothing downstream of the transaction may run — a second receipt for one
    // payment is a tax document that should not exist.
    expect(issueTaxReceipt).not.toHaveBeenCalled();
    expect(queueReceiptClaim).not.toHaveBeenCalled();
  });

  it("does not swallow a real transaction failure as a duplicate", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue(baseDonation as never);
    mocked(prisma.nGOCompliance.findUnique).mockResolvedValue(null as never);
    // A deadlock/connection error, NOT P2002. This payment may never have been
    // recorded, so the response must let Razorpay retry.
    mocked(prisma.$transaction).mockRejectedValueOnce(
      Object.assign(new Error("connection reset"), { code: "P1001" }) as never
    );

    const res = await POST(signedRequest(capturedEvent("order_123", "pay_999")));

    expect(res.status).not.toBe(200);
    expect(issueTaxReceipt).not.toHaveBeenCalled();
  });

  it("issues the tax receipt when the donor's PAN is verified", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue(baseDonation as never);
    mocked(prisma.nGOCompliance.findUnique).mockResolvedValue(null as never);
    mocked(prisma.donation.findUnique).mockResolvedValue(baseDonation as never);

    await POST(signedRequest(capturedEvent()));

    expect(issueTaxReceipt).toHaveBeenCalledWith("don_1");
    expect(queueReceiptClaim).not.toHaveBeenCalled();
  });

  it("queues a receipt claim instead when the PAN is not verified", async () => {
    mocked(evaluateReceiptEligibility).mockReturnValueOnce({
      eligible: false,
      reason: "PAN_NOT_VERIFIED",
    });
    mocked(prisma.donation.findFirst).mockResolvedValue(baseDonation as never);
    mocked(prisma.nGOCompliance.findUnique).mockResolvedValue(null as never);
    mocked(prisma.donation.findUnique).mockResolvedValue(baseDonation as never);

    await POST(signedRequest(capturedEvent()));

    expect(issueTaxReceipt).not.toHaveBeenCalled();
    expect(queueReceiptClaim).toHaveBeenCalledTimes(1);
  });
});

describe("payment.failed", () => {
  it("schedules a retry and keeps the donation PENDING while retries remain", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue({
      ...baseDonation,
      retryCount: 0,
    } as never);

    const res = await POST(signedRequest(failedEvent()));

    expect(res.status).toBe(200);
    expect(prisma.donation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "don_1" },
        data: expect.objectContaining({ retryCount: 1 }),
      })
    );
    // Status must NOT be flipped to FAILED yet
    const updateData = mocked(prisma.donation.update).mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("status");
    expect(sendPaymentRetryEmail).not.toHaveBeenCalled();
  });

  it("marks FAILED and emails a retry link once retries are exhausted", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue({
      ...baseDonation,
      retryCount: 2,
    } as never);

    const res = await POST(signedRequest(failedEvent()));

    expect(res.status).toBe(200);
    expect(prisma.donation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          retryCount: 3,
          retryToken: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      })
    );
    expect(sendPaymentRetryEmail).toHaveBeenCalledWith(
      "donor@example.com",
      "Donor",
      "Clean Water",
      500,
      expect.stringContaining("/donor/retry/")
    );
  });

  it("acknowledges unknown orders without updating anything", async () => {
    mocked(prisma.donation.findFirst).mockResolvedValue(null as never);

    const res = await POST(signedRequest(failedEvent("order_unknown")));

    expect(res.status).toBe(200);
    expect(prisma.donation.update).not.toHaveBeenCalled();
  });
});
