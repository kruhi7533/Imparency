import { describe, it, expect } from "vitest";
import { buildMoneyTimeline } from "@/lib/finance-case-file";

/**
 * What these tests protect.
 *
 * The timeline is read as evidence: an admin uses it to answer "what happened
 * with this payment?" to a donor, an organisation, or an auditor. Two ways it
 * could mislead — putting events in the wrong order, so cause and effect
 * appear reversed, and silently dropping a record, so something that DID
 * happen reads as never having happened.
 *
 * It is re-derived from the source rows on every render rather than stored, so
 * these tests pin the derivation, which is the only place it can go wrong.
 */

const base = {
  donation: {
    createdAt: new Date("2026-09-01T10:00:00Z"),
    razorpayOrderId: "order_1",
    retryCount: 0,
    lastFailedAt: null,
  },
  ledger: [],
  webhookEvents: [],
  receipt: null,
  receiptEvents: [],
  proofs: [],
  impactReports: [],
  exceptions: [],
  adminActions: [],
};

describe("the money timeline", () => {
  it("always starts with the donor's intent", () => {
    const timeline = buildMoneyTimeline(base);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "INTENT", title: "Donation started" });
    expect(timeline[0].detail).toContain("order_1");
  });

  it("orders events by when they happened, not by which table they came from", () => {
    // The receipt is issued seconds after capture, but its row is passed in a
    // different argument. Sorting by source would tell the story backwards.
    const timeline = buildMoneyTimeline({
      ...base,
      receipt: { receiptNumber: "IMP/2026-27/00001", issuedAt: new Date("2026-09-01T10:05:00Z") },
      ledger: [
        {
          entryType: "DONATION_CAPTURED",
          direction: "CREDIT",
          amount: "1000.00",
          occurredAt: new Date("2026-09-01T10:02:00Z"),
          externalRef: "pay_1",
        },
      ],
    });

    expect(timeline.map((e) => e.kind)).toEqual(["INTENT", "MONEY_IN", "DOCUMENT"]);
  });

  it("distinguishes money arriving from money going back", () => {
    const timeline = buildMoneyTimeline({
      ...base,
      ledger: [
        {
          entryType: "DONATION_CAPTURED",
          direction: "CREDIT",
          amount: "1000.00",
          occurredAt: new Date("2026-09-01T10:02:00Z"),
          externalRef: "pay_1",
        },
        {
          entryType: "DONATION_REFUNDED",
          direction: "DEBIT",
          amount: "400.00",
          occurredAt: new Date("2026-09-05T09:00:00Z"),
          externalRef: "rfnd_1",
        },
      ],
    });

    const money = timeline.filter((e) => e.kind === "MONEY_IN" || e.kind === "MONEY_OUT");
    expect(money[0]).toMatchObject({ kind: "MONEY_IN" });
    expect(money[0].title).toContain("1000.00");
    expect(money[1]).toMatchObject({ kind: "MONEY_OUT" });
    expect(money[1].title).toContain("400.00");
  });

  it("records who took a copy of the tax receipt", () => {
    // The first question asked about a tax document is who has it.
    const timeline = buildMoneyTimeline({
      ...base,
      receiptEvents: [
        { event: "DOWNLOADED", createdAt: new Date("2026-09-02T08:00:00Z"), actorId: "user_9" },
        { event: "GENERATED", createdAt: new Date("2026-09-01T10:05:00Z"), actorId: null },
      ],
    });

    const docs = timeline.filter((e) => e.kind === "DOCUMENT");
    expect(docs[0].detail).toBe("by the platform");
    expect(docs[1].detail).toBe("by user_9");
  });

  it("shows a failed attempt as a problem, not as nothing", () => {
    const timeline = buildMoneyTimeline({
      ...base,
      donation: { ...base.donation, retryCount: 2, lastFailedAt: new Date("2026-09-01T10:01:00Z") },
    });

    const problem = timeline.find((e) => e.kind === "PROBLEM");
    expect(problem?.title).toContain("failed");
    expect(problem?.detail).toContain("2 attempts");
  });

  it("carries both the raising and the closing of an exception", () => {
    const timeline = buildMoneyTimeline({
      ...base,
      exceptions: [
        {
          type: "PAYMENT_AMOUNT_MISMATCH",
          firstSeenAt: new Date("2026-09-01T10:03:00Z"),
          resolvedAt: new Date("2026-09-03T11:00:00Z"),
          summary: "Captured 300.00 against a donation created for 500.00",
        },
      ],
    });

    expect(timeline.map((e) => e.title)).toEqual([
      "Donation started",
      "Finance exception raised: payment amount mismatch",
      "Finance exception resolved",
    ]);
  });

  it("does not claim the donor read an impact report that was only sent", () => {
    const sentOnly = buildMoneyTimeline({
      ...base,
      impactReports: [{ sentAt: new Date("2026-09-10T10:00:00Z"), readAt: null }],
    });
    expect(sentOnly.filter((e) => e.kind === "DELIVERY")).toHaveLength(1);

    const read = buildMoneyTimeline({
      ...base,
      impactReports: [
        { sentAt: new Date("2026-09-10T10:00:00Z"), readAt: new Date("2026-09-11T10:00:00Z") },
      ],
    });
    expect(read.filter((e) => e.kind === "DELIVERY")).toHaveLength(2);
  });

  it("includes the evidence the organisation filed against what this funded", () => {
    const timeline = buildMoneyTimeline({
      ...base,
      proofs: [
        {
          submittedAt: new Date("2026-09-20T10:00:00Z"),
          milestoneTitle: "Water tank installed",
          documentCount: 3,
        },
      ],
    });

    const delivery = timeline.find((e) => e.kind === "DELIVERY");
    expect(delivery?.title).toContain("Water tank installed");
    expect(delivery?.detail).toBe("3 files attached");
  });

  it("loses nothing when every source has rows", () => {
    // The real risk in a derived view is a forgotten source, not a wrong one.
    const timeline = buildMoneyTimeline({
      donation: {
        createdAt: new Date("2026-09-01T10:00:00Z"),
        razorpayOrderId: "order_1",
        retryCount: 1,
        lastFailedAt: new Date("2026-09-01T10:01:00Z"),
      },
      ledger: [
        {
          entryType: "DONATION_CAPTURED",
          direction: "CREDIT",
          amount: "1000.00",
          occurredAt: new Date("2026-09-01T10:02:00Z"),
          externalRef: "pay_1",
        },
      ],
      webhookEvents: [
        { eventType: "payment.captured", processedAt: new Date("2026-09-01T10:02:05Z"), payloadId: "pay_1" },
      ],
      receipt: { receiptNumber: "IMP/2026-27/00001", issuedAt: new Date("2026-09-01T10:05:00Z") },
      receiptEvents: [{ event: "GENERATED", createdAt: new Date("2026-09-01T10:05:01Z"), actorId: null }],
      proofs: [
        { submittedAt: new Date("2026-09-20T10:00:00Z"), milestoneTitle: "Tank", documentCount: 1 },
      ],
      impactReports: [{ sentAt: new Date("2026-09-25T10:00:00Z"), readAt: null }],
      exceptions: [
        {
          type: "STALE_PENDING_DONATION",
          firstSeenAt: new Date("2026-09-02T10:00:00Z"),
          resolvedAt: null,
          summary: "stuck",
        },
      ],
      adminActions: [
        { action: "PROOF_APPROVED", createdAt: new Date("2026-09-21T10:00:00Z"), note: null },
      ],
    });

    // intent, failure, capture, webhook, receipt, receipt event, exception,
    // proof, admin action, impact report.
    expect(timeline).toHaveLength(10);
    const times = timeline.map((e) => e.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
