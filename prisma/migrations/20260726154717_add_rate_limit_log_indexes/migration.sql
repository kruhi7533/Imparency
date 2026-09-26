-- CreateIndex
CREATE INDEX "RateLimitLog_identifier_route_windowStart_idx" ON "RateLimitLog"("identifier", "route", "windowStart");

-- CreateIndex
CREATE INDEX "RateLimitLog_windowStart_idx" ON "RateLimitLog"("windowStart");
