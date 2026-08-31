import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/**
 * How long a row survives after its last write, independent of the caller's
 * window. This MUST stay comfortably above the longest window any caller uses
 * (currently 86400s — see `donor/receipts/claim`), because the prune runs on
 * every rate-limited request regardless of which route triggered it. Pruning
 * with the caller's own threshold — as this used to — let a 60s route delete a
 * still-active 24h row and silently reset that limit.
 */
const PRUNE_AFTER_SECONDS = 7 * 24 * 60 * 60;

/**
 * Custom database-backed rate-limiter using the RateLimitLog table.
 * Resolves statelessness in serverless platforms like Vercel.
 *
 * The whole decision is one statement. Splitting it into findFirst + create /
 * update cost a second network round trip — which is not free against a remote
 * Postgres — and left a race open: two concurrent requests could both read a
 * count below the limit and both increment it, so the limit could be exceeded
 * by however many requests arrived together. `INSERT .. ON CONFLICT DO UPDATE`
 * is atomic, so the increment and the read of its result cannot interleave.
 */
export async function rateLimit(
  identifier: string,
  route: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ success: boolean; limitRemaining: number }> {
  const now = new Date();
  const windowThreshold = new Date(now.getTime() - windowSeconds * 1000);
  const pruneThreshold = new Date(now.getTime() - PRUNE_AFTER_SECONDS * 1000);

  // Background prune of long-dead rows. Deliberately not awaited: it only
  // bounds table growth and must never add latency to the request deciding
  // whether it is allowed to proceed.
  prisma.rateLimitLog
    .deleteMany({ where: { windowStart: { lt: pruneThreshold } } })
    .catch((err) => {
      console.error("Failed to prune expired rate limit logs:", err);
    });

  // One row per (identifier, route) — see the unique index in schema.prisma.
  // When the stored window has aged out, the same statement resets the counter
  // to 1 and restarts the window; otherwise it increments in place.
  const rows = await prisma.$queryRaw<{ requestCount: number }[]>`
    INSERT INTO "RateLimitLog" ("id", "identifier", "route", "requestCount", "windowStart")
    VALUES (${randomUUID()}, ${identifier}, ${route}, 1, ${now})
    ON CONFLICT ("identifier", "route") DO UPDATE SET
      "requestCount" = CASE
        WHEN "RateLimitLog"."windowStart" < ${windowThreshold} THEN 1
        ELSE "RateLimitLog"."requestCount" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitLog"."windowStart" < ${windowThreshold} THEN ${now}
        ELSE "RateLimitLog"."windowStart"
      END
    RETURNING "requestCount"
  `;

  // This request is the Nth in the window, so N > max means it is the one that
  // broke the limit. Counting past the limit rather than refusing to increment
  // keeps the statement single-shot, and leaves the overshoot visible.
  const requestCount = rows[0]?.requestCount ?? 1;
  const success = requestCount <= maxRequests;

  return {
    success,
    limitRemaining: success ? Math.max(0, maxRequests - requestCount) : 0,
  };
}

/**
 * Standard request rate-limiter wrapper for API Routes.
 * Extracts client IP and returns a 429 response if limit is exceeded.
 */
type RateLimitCheck =
  | { isBlocked: true; response: NextResponse; headers?: undefined }
  | { isBlocked: false; response: null; headers: Record<string, string> };

export async function checkRateLimit(
  request: Request,
  route: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitCheck> {
  // Extract client IP address
  const xForwardedFor = request.headers.get("x-forwarded-for");
  let ip = "unknown";
  
  if (xForwardedFor) {
    ip = xForwardedFor.split(",")[0].trim();
  } else {
    ip = request.headers.get("x-real-ip") || "unknown";
  }

  const { success, limitRemaining } = await rateLimit(ip, route, maxRequests, windowSeconds);

  if (!success) {
    return {
      isBlocked: true,
      response: NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": windowSeconds.toString(),
            "X-RateLimit-Limit": maxRequests.toString(),
            "X-RateLimit-Remaining": "0",
          },
        }
      ),
    };
  }

  return {
    isBlocked: false,
    response: null,
    headers: {
      "X-RateLimit-Limit": maxRequests.toString(),
      "X-RateLimit-Remaining": limitRemaining.toString(),
    },
  };
}
