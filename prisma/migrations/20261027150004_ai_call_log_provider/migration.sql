-- AI-009: which provider answered (gemini | anthropic | openai-compatible |
-- rules). "rules" rows record deterministic, no-model runs (e.g. NGO field
-- extraction without a key) so telemetry shows they happened.
-- Default matches schema.prisma @default("gemini").
ALTER TABLE "AiCallLog" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'gemini';
