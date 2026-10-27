-- Donor notification channel preferences and delivery log (DON-018 / NEG-011).
--
-- NotificationPreference: per-channel switches (WhatsApp, email, in-app). No
-- row means the defaults (all on).
-- NotificationDeliveryLog: one row per channel attempt for a donor message,
-- with status SENT / FAILED / OPTED_OUT / PROVIDER_NOT_CONFIGURED and a reason.
-- @@unique(userId, eventKey, channel, attempt) makes a re-fired event a no-op.
-- Carries the message title/body (the same text the Notification table holds)
-- so a FAILED attempt can be replayed from the dead-letter queue; never an
-- email address or phone number.
--
-- Hand-written and additive. updatedAt is @updatedAt: no DB default.

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "userId"    TEXT NOT NULL,
  "whatsapp"  BOOLEAN NOT NULL DEFAULT true,
  "email"     BOOLEAN NOT NULL DEFAULT true,
  "inApp"     BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "NotificationDeliveryLog" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "eventKey"  TEXT NOT NULL,
  "topic"     TEXT NOT NULL,
  "channel"   TEXT NOT NULL,
  "status"    TEXT NOT NULL,
  "reason"    TEXT,
  "attempt"   INTEGER NOT NULL DEFAULT 1,
  "title"     TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDeliveryLog_userId_eventKey_channel_attempt_key"
  ON "NotificationDeliveryLog"("userId", "eventKey", "channel", "attempt");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryLog_userId_createdAt_idx" ON "NotificationDeliveryLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryLog_status_createdAt_idx" ON "NotificationDeliveryLog"("status", "createdAt");
