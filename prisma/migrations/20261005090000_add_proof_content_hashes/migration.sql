-- Week 7 "money -> work -> evidence": content fingerprints on milestone proof
-- files, so the same photograph cannot be submitted as evidence twice without
-- a human being told. See lib/proof-fingerprint.ts.
--
-- Additive and re-runnable (IF NOT EXISTS) so it can be applied by hand to the
-- shared Neon dev database, which carries tables this schema does not know
-- about — see CLAUDE.md on why `migrate dev` is not used here.
--
-- DEFAULT is an empty array rather than NULL: every existing proof gets `{}`,
-- which reads as "not fingerprinted" and is exactly what
-- tools/backfill-proof-hashes.ts goes looking for. Nothing reads an empty
-- array as "no duplicates found".

ALTER TABLE "MilestoneProof"
    ADD COLUMN IF NOT EXISTS "contentHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- GIN, not B-tree: the duplicate lookup is an array containment test
-- (`contentHashes hasSome [...]`), which a B-tree index cannot serve.
CREATE INDEX IF NOT EXISTS "MilestoneProof_contentHashes_idx"
    ON "MilestoneProof" USING GIN ("contentHashes");
