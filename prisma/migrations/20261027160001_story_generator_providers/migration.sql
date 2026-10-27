-- Record which provider wrote an impact story: Claude, Gemini, or the
-- deterministic template. AI_MODEL (added an hour earlier, never used by any
-- stored row outside dev) becomes GEMINI.
ALTER TYPE "ImpactStoryGenerator" RENAME VALUE 'AI_MODEL' TO 'GEMINI';
ALTER TYPE "ImpactStoryGenerator" ADD VALUE 'CLAUDE' BEFORE 'GEMINI';
