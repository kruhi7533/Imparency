-- RateLimitLog moves to one row per (identifier, route) so `rateLimit()` can do
-- its whole job in one atomic INSERT .. ON CONFLICT DO UPDATE.
--
-- Existing rows may contain duplicates for a pair (the old code created a new
-- row per window), so they have to be collapsed before the unique index can be
-- created. Keeping the most recent row per pair preserves any in-flight window;
-- the discarded rows are expired counters that the background prune would have
-- deleted anyway, and they carry no business meaning.
DELETE FROM "RateLimitLog"
WHERE id NOT IN (
  SELECT DISTINCT ON (identifier, route) id
  FROM "RateLimitLog"
  ORDER BY identifier, route, "windowStart" DESC, id DESC
);

-- Redundant once (identifier, route) is unique: only one row can ever match, so
-- the trailing windowStart column bought nothing and cost a second index to
-- maintain on a table written to by every rate-limited request.
DROP INDEX IF EXISTS "RateLimitLog_identifier_route_windowStart_idx";

CREATE UNIQUE INDEX "RateLimitLog_identifier_route_key" ON "RateLimitLog"("identifier", "route");
