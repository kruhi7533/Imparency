-- Week-6 idempotency: a processed-webhook ledger for the payment path.
--
-- The donations webhook previously guarded replay with a read of
-- `Donation.status` taken outside its transaction, so two concurrent
-- deliveries of the same captured payment could both pass the guard and both
-- increment Project.raisedAmount / User.totalDonated. This table is written
-- inside that transaction; the unique index is what actually serialises them.
--
-- Purely additive and idempotent, so it can also be applied by hand to the
-- shared dev database (see CLAUDE.md on why migrate dev is not used here).

CREATE TABLE IF NOT EXISTS "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "eventType" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payloadId" TEXT,
    "eventId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- The load-bearing constraint: the loser of a concurrent redelivery race fails
-- here, which rolls back the money movement in the same transaction.
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_dedupeKey_key" ON "WebhookEvent"("dedupeKey");

CREATE INDEX IF NOT EXISTS "WebhookEvent_eventType_processedAt_idx" ON "WebhookEvent"("eventType", "processedAt");
