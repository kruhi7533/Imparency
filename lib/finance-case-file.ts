import prisma from "@/lib/prisma";

/**
 * Everything the platform holds about one transaction, in one place.
 *
 * The ledger answers "how much moved, and when". An admin asked about a
 * specific payment needs more than that: what the donor was told, what
 * document was issued to them, what the organisation did with the money, and
 * who touched any of it afterwards. Those facts exist today — spread across
 * seven tables and four pages, none of which are reachable from a ledger row.
 *
 * This assembles them into a case file. It is READ-ONLY: nothing here writes,
 * because a page whose job is to be trusted as evidence must not also be a
 * place where evidence changes.
 *
 * Two things are deliberately NOT gathered:
 *   - The donor's PAN number. The compliance snapshot records whether it was
 *     verified, which is the fact that governs the receipt. The number itself
 *     is not needed to answer any finance question, and an admin finance page
 *     is not a place to expose it.
 *   - The payment retry TOKEN. It is a bearer credential that lets anyone
 *     holding it resume a checkout.
 */

export interface MoneyTimelineEvent {
  at: Date;
  /** Drives the icon and colour; keep the set small and meaningful. */
  kind: "INTENT" | "MONEY_IN" | "MONEY_OUT" | "DOCUMENT" | "DELIVERY" | "PROBLEM" | "ADMIN";
  title: string;
  detail?: string;
}

/**
 * The transaction as a story, in order.
 *
 * Built from every source separately rather than from a single event table,
 * because there is no single event table — and inventing one would mean
 * trusting a new write path over records that already exist. The cost is this
 * function; the benefit is that the timeline cannot drift from the facts,
 * since it IS the facts, re-derived on every render.
 */
export function buildMoneyTimeline(input: {
  donation: { createdAt: Date; razorpayOrderId: string; retryCount: number; lastFailedAt: Date | null };
  ledger: Array<{ entryType: string; direction: string; amount: { toString(): string }; occurredAt: Date; externalRef: string | null }>;
  webhookEvents: Array<{ eventType: string; processedAt: Date; payloadId: string | null }>;
  receipt: { receiptNumber: string; issuedAt: Date } | null;
  receiptEvents: Array<{ event: string; createdAt: Date; actorId: string | null }>;
  proofs: Array<{ submittedAt: Date; milestoneTitle: string; documentCount: number }>;
  impactReports: Array<{ sentAt: Date; readAt: Date | null }>;
  exceptions: Array<{ type: string; firstSeenAt: Date; resolvedAt: Date | null; summary: string }>;
  adminActions: Array<{ action: string; createdAt: Date; note: string | null }>;
}): MoneyTimelineEvent[] {
  const events: MoneyTimelineEvent[] = [];
  const money = (v: { toString(): string }) => `₹${Number(v.toString()).toFixed(2)}`;

  events.push({
    at: input.donation.createdAt,
    kind: "INTENT",
    title: "Donation started",
    detail: `Order ${input.donation.razorpayOrderId}`,
  });

  if (input.donation.lastFailedAt) {
    events.push({
      at: input.donation.lastFailedAt,
      kind: "PROBLEM",
      title: `Payment attempt failed`,
      detail: `${input.donation.retryCount} attempt${input.donation.retryCount === 1 ? "" : "s"} recorded`,
    });
  }

  for (const entry of input.ledger) {
    const inbound = entry.direction === "CREDIT";
    events.push({
      at: entry.occurredAt,
      kind: inbound ? "MONEY_IN" : "MONEY_OUT",
      title: inbound ? `Payment captured — ${money(entry.amount)}` : `Refunded — ${money(entry.amount)}`,
      detail: entry.externalRef ? `Reference ${entry.externalRef}` : undefined,
    });
  }

  for (const hook of input.webhookEvents) {
    events.push({
      at: hook.processedAt,
      kind: "ADMIN",
      title: `Provider notified us: ${hook.eventType}`,
      detail: hook.payloadId ?? undefined,
    });
  }

  if (input.receipt) {
    events.push({
      at: input.receipt.issuedAt,
      kind: "DOCUMENT",
      title: `80G receipt issued`,
      detail: input.receipt.receiptNumber,
    });
  }

  for (const event of input.receiptEvents) {
    events.push({
      at: event.createdAt,
      kind: "DOCUMENT",
      title: `Receipt ${event.event.toLowerCase()}`,
      // Who took a copy is the question an auditor asks first about a document.
      detail: event.actorId ? `by ${event.actorId}` : "by the platform",
    });
  }

  for (const proof of input.proofs) {
    events.push({
      at: proof.submittedAt,
      kind: "DELIVERY",
      title: `Evidence submitted — ${proof.milestoneTitle}`,
      detail: `${proof.documentCount} file${proof.documentCount === 1 ? "" : "s"} attached`,
    });
  }

  for (const report of input.impactReports) {
    events.push({ at: report.sentAt, kind: "DELIVERY", title: "Impact report sent to the donor" });
    if (report.readAt) {
      events.push({ at: report.readAt, kind: "DELIVERY", title: "Donor opened the impact report" });
    }
  }

  for (const exception of input.exceptions) {
    events.push({
      at: exception.firstSeenAt,
      kind: "PROBLEM",
      title: `Finance exception raised: ${exception.type.replaceAll("_", " ").toLowerCase()}`,
      detail: exception.summary,
    });
    if (exception.resolvedAt) {
      events.push({ at: exception.resolvedAt, kind: "ADMIN", title: "Finance exception resolved" });
    }
  }

  for (const action of input.adminActions) {
    events.push({
      at: action.createdAt,
      kind: "ADMIN",
      title: action.action.replaceAll("_", " ").toLowerCase(),
      detail: action.note ?? undefined,
    });
  }

  // Oldest first: this is read as a story, not as an inbox.
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Loads one transaction and everything attached to it. Null if it is gone. */
export async function loadDonationCaseFile(donationId: string) {
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    select: {
      id: true,
      amount: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      razorpayOrderId: true,
      razorpayPaymentId: true,
      milestoneIds: true,
      retryCount: true,
      lastFailedAt: true,
      complianceSnapshot: true,
      donorId: true,
      projectId: true,
      donor: {
        select: {
          id: true,
          name: true,
          email: true,
          // Status, never the PAN number itself.
          panStatus: true,
          panVerifiedVia: true,
          donorCategory: true,
        },
      },
      project: {
        select: {
          id: true,
          title: true,
          ngoId: true,
          ngo: { select: { id: true, orgName: true, verificationStatus: true } },
        },
      },
      taxReceipt: { select: { id: true, receiptNumber: true, financialYear: true, issuedAt: true } },
      impactReports: { select: { id: true, sentAt: true, readAt: true, sdgTags: true } },
    },
  });

  if (!donation) return null;

  const ledger = await prisma.ledgerEntry.findMany({
    where: { donationId: donation.id },
    orderBy: { occurredAt: "asc" },
  });

  // Webhook deliveries are keyed on the provider's id for the SUBJECT, which
  // is the payment for a capture and the refund for a refund — so both have to
  // be looked up, not just the payment.
  const providerIds = [
    donation.razorpayPaymentId,
    ...ledger.map((e) => e.externalRef),
  ].filter((v): v is string => Boolean(v));

  const [webhookEvents, exceptions, receiptEvents, milestones, adminActions] = await Promise.all([
    providerIds.length
      ? prisma.webhookEvent.findMany({
          where: { payloadId: { in: providerIds } },
          orderBy: { processedAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.financeException.findMany({
      where: { entityId: { in: [donation.id, ...providerIds] } },
      orderBy: { firstSeenAt: "asc" },
    }),
    donation.taxReceipt
      ? prisma.receiptEvent.findMany({
          where: { receiptId: donation.taxReceipt.id },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    donation.milestoneIds.length
      ? prisma.milestone.findMany({
          where: { id: { in: donation.milestoneIds } },
          select: {
            id: true,
            title: true,
            status: true,
            targetAmount: true,
            proofs: {
              select: {
                id: true,
                description: true,
                submittedAt: true,
                mediaUrls: true,
                documentUrls: true,
              },
              orderBy: { submittedAt: "desc" },
            },
          },
        })
      : Promise.resolve([]),
    prisma.adminActionLog.findMany({
      where: { entityType: "DONATION", entityId: donation.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, createdAt: true, note: true, adminId: true },
    }),
  ]);

  return { donation, ledger, webhookEvents, exceptions, receiptEvents, milestones, adminActions };
}

export type DonationCaseFile = NonNullable<Awaited<ReturnType<typeof loadDonationCaseFile>>>;
