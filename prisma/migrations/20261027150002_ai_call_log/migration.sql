-- AI call telemetry (AI-009 / AI-010).
--
-- One row per model call made through lib/ai/telemetry.ts: call site, model,
-- prompt version, latency, token usage when the provider reports it, a cost
-- ESTIMATE, and the outcome. No prompt or response text is stored — prompts
-- carry NGO and donor data.
--
-- Hand-written and additive.

CREATE TABLE IF NOT EXISTS "AiCallLog" (
  "id"            TEXT NOT NULL,
  "site"          TEXT NOT NULL,
  "model"         TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "outcome"       TEXT NOT NULL,
  "faultInjected" BOOLEAN NOT NULL DEFAULT false,
  "latencyMs"     INTEGER NOT NULL,
  "tokensIn"      INTEGER,
  "tokensOut"     INTEGER,
  "costUsd"       DECIMAL(12,6),
  "errorCode"     TEXT,
  "correlationId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCallLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiCallLog_createdAt_idx" ON "AiCallLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AiCallLog_site_createdAt_idx" ON "AiCallLog"("site", "createdAt");
