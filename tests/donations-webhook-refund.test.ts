import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/prisma", () => ({
  default: {
    donation: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    project: { update: vi.fn() },
    user: { update: vi.fn() },
    nGOCompliance: { findUnique: vi.fn() },
    webhookEvent: { create: vi.fn() },
    ledgerEntry: { create: vi.fn(), findMany: vi.fn() },
    financeException: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    impactReport: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
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
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

import prisma from "@/lib/prisma";
import { POST } from "@/app/api/donations/webhook/route";

const db = prisma as any;
const SECRET = "test-webhook-secret";

/**
 * What these tests protect.
 *
 * Two failures that only appear once real money flows.
 *
 * The first is the one nothing else could catch: the route recorded the
 * amount the donation was CREATED for and never read what the provider
 * actually captured. Every downstream check derives from that same requested
 * amount, so an over- or under-capture left the ledger, the project total and
 * the donor total all agreeing with each other and all wrong.
 *
 * The second is refunds. Unhandled, a refund left every total permanently
 * overstated with no record that money went back.
 */

function signed(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  return new Request("http://localhost/api/donations/webhook", {
    method: "POST",
    body,
    headers: { "x-razorpay-signature": signature },
  });
}

function captured(amountPaise: number | undefined, paymentId = "pay_1") {
  return {
    event: "payment.captured",
    payload: {
      payment: { entity: { order_id: "order_1", id: paymentId, amount: amountPaise } },
    },
  };
}

function refund(overrides: Record<string, unknown> = {}, eventName = "refund.processed") {
  return {
    event: eventName,
    payload: {
      refund: {
        entity: {
          id: "rfnd_1",
          payment_id: "pay_1",
          amount: 50000,
          created_at: 1759228800,
          ...overrides,
        },
      },
    },
  };
}

const donationForCapture = {
  id: "don_1",
  status: "PENDING",
  amount: "500.00",
  donorId: "user_1",
  projectId: "proj_1",
  retryCount: 0,
  donor: {
    id: "user_1",
    email: "donor@example.com",
    name: "Donor",
    panStatus: "VERIFIED",
    panVerifiedVia: "MANUAL",
    donorCategory: "INDIAN_IN_INDIA",
    nriSourceDeclaration: null,
  },
  project: { id: "proj_1", title: "Clean Water", ngoId: "ngo_1", ngo: { id: "ngo_1", healthScore: 80 } },
};

const donationForRefund = {
  id: "don_1",
  amount: "500.00",
  status: "SUCCESS",
  donorId: "user_1",
  projectId: "proj_1",
  project: { ngoId: "ngo_1" },
  taxReceipt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
  db.$transaction.mockResolvedValue([]);
  db.donation.findUnique.mockResolvedValue(donationForCapture);
  db.nGOCompliance.findUnique.mockResolvedValue(null);
  db.ledgerEntry.findMany.mockResolvedValue([]);
  db.financeException.findFirst.mockResolvedValue(null);
  db.financeException.count.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the captured amount, not the requested one", () => {
  it("records what the provider actually captured when it differs", async () => {
    // Donation created for 500.00; only 300.00 was captured.
    db.donation.findFirst.mockResolvedValue(donationForCapture);

    await POST(signed(captured(30000)));

    const entry = db.ledgerEntry.create.mock.calls[0][0].data;
    expect(entry.amount.toFixed(2)).toBe("300.00");
    // Counters move by the captured amount too, so they keep agreeing with
    // the ledger — otherwise reconciliation would report a project-total
    // drift and point at the wrong problem.
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: "proj_1" },
      data: { raisedAmount: { increment: expect.anything() } },
    });
    expect(db.project.update.mock.calls[0][0].data.raisedAmount.increment.toFixed(2)).toBe("300.00");
    expect(db.user.update.mock.calls[0][0].data.totalDonated.increment.toFixed(2)).toBe("300.00");
  });

  it("raises an exception naming both amounts", async () => {
    db.donation.findFirst.mockResolvedValue(donationForCapture);

    await POST(signed(captured(30000)));

    const data = db.financeException.create.mock.calls[0][0].data;
    expect(data.type).toBe("PAYMENT_AMOUNT_MISMATCH");
    expect(data.entityId).toBe("don_1");
    expect(data.expectedAmount.toFixed(2)).toBe("500.00");
    expect(data.observedAmount.toFixed(2)).toBe("300.00");
    expect(data.detail.overpaid).toBe(false);
  });

  it("flags an OVER-capture too, not just a shortfall", async () => {
    db.donation.findFirst.mockResolvedValue(donationForCapture);

    await POST(signed(captured(90000)));

    expect(db.financeException.create.mock.calls[0][0].data.detail.overpaid).toBe(true);
  });

  it("raises nothing when the amounts agree", async () => {
    db.donation.findFirst.mockResolvedValue(donationForCapture);

    await POST(signed(captured(50000)));

    expect(db.financeException.create).not.toHaveBeenCalled();
  });

  it("still records the payment when the amount is unreadable", async () => {
    // Applying nothing would mean money taken and not recorded — worse than
    // applying the only number we have.
    db.donation.findFirst.mockResolvedValue(donationForCapture);

    const res = await POST(signed(captured(undefined)));

    expect(res.status).toBe(200);
    expect(db.ledgerEntry.create.mock.calls[0][0].data.amount.toFixed(2)).toBe("500.00");
    expect(db.financeException.create).not.toHaveBeenCalled();
  });

  it("does not let a failed finding stop the payment being recorded", async () => {
    db.donation.findFirst.mockResolvedValue(donationForCapture);
    // Once, not permanently: clearAllMocks() resets calls but NOT
    // implementations, so a persistent rejection here leaks into every later
    // test that writes a finding.
    db.financeException.create.mockRejectedValueOnce(new Error("exception queue down"));

    const res = await POST(signed(captured(30000)));

    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("refunds", () => {
  it("writes a DEBIT entry keyed on the refund, not the payment", async () => {
    // A payment can be refunded more than once; keying on the payment id
    // would silently drop every refund after the first.
    db.donation.findFirst.mockResolvedValue(donationForRefund);

    const res = await POST(signed(refund()));

    expect(res.status).toBe(200);
    const entry = db.ledgerEntry.create.mock.calls[0][0].data;
    expect(entry.entryType).toBe("DONATION_REFUNDED");
    expect(entry.direction).toBe("DEBIT");
    expect(entry.amount.toFixed(2)).toBe("500.00");
    expect(entry.idempotencyKey).toBe("DONATION_REFUNDED:rfnd_1");
    expect(entry.externalRef).toBe("rfnd_1");
  });

  it("brings the project and donor totals back down", async () => {
    db.donation.findFirst.mockResolvedValue(donationForRefund);

    await POST(signed(refund()));

    expect(db.project.update.mock.calls[0][0].data.raisedAmount.decrement.toFixed(2)).toBe("500.00");
    expect(db.user.update.mock.calls[0][0].data.totalDonated.decrement.toFixed(2)).toBe("500.00");
  });

  it("marks the donation REFUNDED once everything has been returned", async () => {
    db.donation.findFirst.mockResolvedValue(donationForRefund);

    await POST(signed(refund()));

    expect(db.donation.update).toHaveBeenCalledWith({
      where: { id: "don_1" },
      data: { status: "REFUNDED" },
    });
  });

  it("leaves the status alone on a PARTIAL refund", async () => {
    // Flipping to REFUNDED on the first partial would claim the donor got all
    // their money back.
    db.donation.findFirst.mockResolvedValue(donationForRefund);

    await POST(signed(refund({ amount: 10000 })));

    expect(db.donation.update).not.toHaveBeenCalled();
    expect(db.ledgerEntry.create.mock.calls[0][0].data.amount.toFixed(2)).toBe("100.00");
  });

  it("counts earlier partial refunds when deciding if it is now fully refunded", async () => {
    db.donation.findFirst.mockResolvedValue(donationForRefund);
    db.ledgerEntry.findMany.mockResolvedValue([{ amount: "400.00" }]);

    await POST(signed(refund({ amount: 10000, id: "rfnd_2" })));

    // 400 already back + 100 now = the full 500.
    expect(db.donation.update).toHaveBeenCalledWith({
      where: { id: "don_1" },
      data: { status: "REFUNDED" },
    });
  });

  it("applies a refund exactly once across refund.created and refund.processed", async () => {
    db.donation.findFirst.mockResolvedValue(donationForRefund);
    // Both events carry the same refund id. The second loses on the unique
    // ledger key rather than debiting the money twice.
    db.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await POST(signed(refund({}, "refund.created")));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ duplicate: true });
  });

  it("records a refund against an unknown payment instead of dropping it", async () => {
    db.donation.findFirst.mockResolvedValue(null);

    const res = await POST(signed(refund()));

    expect(res.status).toBe(200);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.financeException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "UNMATCHED_PAYMENT", entityId: "pay_1" }),
    });
  });

  it("flags a refund on a donation that already has an 80G receipt", async () => {
    // The receipt is a document the donor may have filed with a tax return —
    // it cannot just be voided in the database and forgotten.
    db.donation.findFirst.mockResolvedValue({
      ...donationForRefund,
      taxReceipt: { id: "rcpt_1" },
    });

    await POST(signed(refund()));

    const types = db.financeException.create.mock.calls.map((c: any[]) => c[0].data.type);
    expect(types).toContain("REFUND_AFTER_RECEIPT");
    expect(db.ledgerEntry.create.mock.calls[0][0].data.metadata.hadTaxReceipt).toBe(true);
  });

  it("acknowledges an unreadable refund payload without writing anything", async () => {
    const res = await POST(signed(refund({ id: undefined, payment_id: undefined })));

    expect(res.status).toBe(200);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.financeException.create).not.toHaveBeenCalled();
  });
});
