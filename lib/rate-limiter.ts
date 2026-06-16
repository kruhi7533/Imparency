import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

/**
 * Custom database-backed rate-limiter using the RateLimitLog table.
 * Resolves statelessness in serverless platforms like Vercel.
 */
export async function rateLimit(
  identifier: string,
  route: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ success: boolean; limitRemaining: number }> {
  const now = new Date();
  const windowThreshold = new Date(now.getTime() - windowSeconds * 1000);

  // 1. Background prune of expired logs (non-blocking)
  prisma.rateLimitLog
    .deleteMany({
      where: {
        windowStart: {
          lt: windowThreshold,
        },
      },
    })
    .catch((err) => {
      console.error("Failed to prune expired rate limit logs:", err);
    });

  // 2. Query active log for this identifier and route
  const activeLog = await prisma.rateLimitLog.findFirst({
    where: {
      identifier,
      route,
      windowStart: {
        gte: windowThreshold,
      },
    },
  });

  if (!activeLog) {
    // Create new log window
    await prisma.rateLimitLog.create({
      data: {
        identifier,
        route,
        requestCount: 1,
        windowStart: now,
      },
    });

    return {
      success: true,
      limitRemaining: maxRequests - 1,
    };
  }

  if (activeLog.requestCount >= maxRequests) {
    // Rate limit exceeded
    return {
      success: false,
      limitRemaining: 0,
    };
  }

  // Increment request count
  const updatedLog = await prisma.rateLimitLog.update({
    where: { id: activeLog.id },
    data: {
      requestCount: {
        increment: 1,
      },
    },
  });

  return {
    success: true,
    limitRemaining: Math.max(0, maxRequests - updatedLog.requestCount),
  };
}

/**
 * Standard request rate-limiter wrapper for API Routes.
 * Extracts client IP and returns a 429 response if limit is exceeded.
 */
export async function checkRateLimit(
  request: Request,
  route: string,
  maxRequests: number,
  windowSeconds: number
) {
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
