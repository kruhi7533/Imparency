import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma, { getRetryStats } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ADMIN-only runtime diagnostics — is the database slow right now, and is it
 * cold starts?
 *
 * `lib/prisma.ts` already counts every retry it performs, precisely so that
 * question can be answered ("do the slow requests correlate with retries, or
 * not?"). Until now nothing read those counters except
 * `scripts/latency-probe.ts`, which has to be run by hand on the server. That
 * makes the one signal that explains latency invisible to the person actually
 * looking at a slow console.
 *
 * The counters matter here because this project runs on Neon's free tier,
 * which suspends the compute after a few minutes of inactivity. The first
 * query after an idle period pays a cold start, surfacing as a
 * PrismaClientInitializationError that the retry wrapper absorbs with backoff
 * — the request succeeds and simply takes ~250ms-4s longer, with nothing in
 * the response to say why. `byCode.INIT` rising is that happening.
 *
 * Deliberately NOT a public health check. It reports internal timing and
 * process state, so it sits behind the same ADMIN guard as the rest of this
 * folder rather than at /api/health where an uptime monitor could reach it.
 */
export async function GET() {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;

  // Round-trip probe. `SELECT 1` does no real work on the server, so almost
  // all of this number is network plus connection handling — the same
  // wall-clock-minus-execution comparison scripts/latency-probe.ts makes, in
  // its cheapest possible form. A large value here with a small query count
  // means the path to the database is the problem, not the queries.
  let roundTripMs: number | null = null;
  let reachable = true;
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    roundTripMs = Date.now() - startedAt;
  } catch {
    reachable = false;
    roundTripMs = Date.now() - startedAt;
  }

  const retries = getRetryStats();

  return NextResponse.json({
    database: {
      reachable,
      roundTripMs,
      /**
       * Retry counters are PROCESS-LOCAL and unsynchronised by design (see
       * lib/prisma.ts). Under multiple workers each reports only its own
       * tally, and every deploy resets them to zero. This is a diagnostic
       * signal for "is something happening right now", not a metric to bill
       * or alert precisely on.
       */
      retries: {
        total: retries.total,
        totalDelayMs: retries.totalDelayMs,
        byCode: retries.byCode,
        byOperation: retries.byOperation,
        /**
         * INIT is PrismaClientInitializationError — overwhelmingly a Neon
         * cold start on the free tier rather than a real fault. Called out
         * separately so a reader does not have to know that mapping.
         */
        coldStartRetries: retries.byCode.INIT ?? 0,
      },
    },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeEnv: process.env.NODE_ENV ?? "unknown",
      /**
       * Whether captureError has somewhere to deliver to. Without this, every
       * swallowed error exists only as a `[capture]` line on stderr, which is
       * ephemeral and unwatched — worth knowing before trusting an absence of
       * alerts as an absence of problems.
       */
      errorCollectorConfigured: Boolean(process.env.ERROR_WEBHOOK_URL),
    },
    // No connection strings, hostnames, credentials or row data — this
    // endpoint reports timing and counters only.
    capturedAt: new Date().toISOString(),
  });
}
