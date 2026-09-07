/* eslint-disable no-var */
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { captureError } from './observability';

// Connection errors that are worth retrying — typically a Neon serverless
// endpoint waking from auto-suspend (cold start) or a brief network blip.
const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 250;

/**
 * Neon's serverless driver talks to Postgres over a WebSocket. A dropped
 * socket surfaces as an `ErrorEvent` from the `error` event — not a
 * `PrismaClientKnownRequestError` or `PrismaClientInitializationError` — so it
 * used to fall straight through the checks below and abort on the first
 * attempt instead of retrying like every other transient connection failure.
 *
 * Matched structurally, not with `instanceof`: `ErrorEvent` is not a global in
 * Node, and the driver bundles its own class, so there is no constructor here
 * to compare against.
 */
export function isTransientWebSocketError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (
    (err as { constructor?: { name?: string } }).constructor?.name === 'ErrorEvent' &&
    (err as { type?: unknown }).type === 'error'
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries used to be completely silent: a query would fail, sleep 250ms, and
 * succeed on the second attempt with nothing recorded anywhere. The request
 * looked healthy and simply took 250ms longer, which made the p95 tail
 * impossible to attribute — a latency probe could measure the spike but never
 * explain it.
 *
 * These counters exist to answer exactly one question: do the slow requests
 * correlate with retries, or not? They observe; they do not change the retry
 * behaviour in any way.
 *
 * Process-local and unsynchronised on purpose. This is a diagnostic signal, not
 * a metric anyone should bill from — in a multi-process deployment each worker
 * keeps its own tally.
 */
export interface RetryStats {
  /** Total retry attempts, not total failed queries. */
  total: number;
  /** Prisma error code → count. `INIT` covers PrismaClientInitializationError. */
  byCode: Record<string, number>;
  /** "model.operation" → count, so a hot spot is visible per call site. */
  byOperation: Record<string, number>;
  /** Total time spent sleeping in backoff — the latency retries actually added. */
  totalDelayMs: number;
}

const retryStats: RetryStats = { total: 0, byCode: {}, byOperation: {}, totalDelayMs: 0 };

/** Snapshot of retry activity since process start (or the last reset). */
export function getRetryStats(): RetryStats {
  return {
    total: retryStats.total,
    byCode: { ...retryStats.byCode },
    byOperation: { ...retryStats.byOperation },
    totalDelayMs: retryStats.totalDelayMs,
  };
}

/** Zero the counters — for probes that want to measure one window. */
export function resetRetryStats(): void {
  retryStats.total = 0;
  retryStats.byCode = {};
  retryStats.byOperation = {};
  retryStats.totalDelayMs = 0;
}

function recordRetry(
  err: unknown,
  code: string,
  model: string | undefined,
  operation: string | undefined,
  attempt: number,
  delayMs: number
): void {
  const op = `${model ?? 'raw'}.${operation ?? 'unknown'}`;
  retryStats.total += 1;
  retryStats.byCode[code] = (retryStats.byCode[code] ?? 0) + 1;
  retryStats.byOperation[op] = (retryStats.byOperation[op] ?? 0) + 1;
  retryStats.totalDelayMs += delayMs;

  // "warning", not "error": the query is expected to succeed on the next
  // attempt, so this is a latency event rather than a failure. captureError
  // never throws and never awaits network I/O, which is why it is safe to call
  // from inside this hot path.
  captureError(
    err,
    {
      scope: 'lib/prisma',
      operation: 'retry_transient_connection_error',
      // Ids only — never query arguments. `args` can contain PII, document
      // contents and donation amounts, and this payload may leave the process.
      extra: {
        code,
        model: model ?? 'raw',
        prismaOperation: operation ?? 'unknown',
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs,
        retryNumberThisProcess: retryStats.total,
      },
    },
    'warning'
  );
}

const prismaClientSingleton = () => {
  const neonPool = new Pool({ connectionString: process.env.DATABASE_URL });

  // An idle pooled connection whose WebSocket drops emits 'error' with no
  // in-flight query to reject. Node treats an unhandled 'error' on an
  // EventEmitter as fatal, so without this listener a background disconnect can
  // take down the process rather than being retried on the next query.
  neonPool.on('error', (err) => {
    captureError(
      err,
      { scope: 'lib/prisma', operation: 'idle_pool_connection_error' },
      'warning'
    );
  });

  const adapter = new PrismaNeon(neonPool);
  const client = new PrismaClient({ adapter });

  // Retry transient connection failures with exponential backoff so a cold
  // Neon endpoint doesn't surface as a hard 500 to the user.
  return client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        let lastError: unknown;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            const code =
              err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined;
            const isInitError = err instanceof Prisma.PrismaClientInitializationError;
            const isWsError = isTransientWebSocketError(err);
            const retryable = isInitError || isWsError || (code && RETRYABLE_CODES.has(code));
            if (attempt < MAX_RETRIES && retryable) {
              const delayMs = BASE_DELAY_MS * 2 ** attempt;
              // Observe, then behave exactly as before: same condition, same
              // delay, same continue. Recording is synchronous and allocation
              // -only, so it cannot itself add latency to the backoff.
              recordRetry(err, isInitError ? 'INIT' : isWsError ? 'WS_ERROR' : code!, model, operation, attempt, delayMs);
              lastError = err;
              await sleep(delayMs);
              continue;
            }
            throw err;
          }
        }
        throw lastError;
      },
    },
  });
};

type ExtendedPrismaClient = ReturnType<typeof prismaClientSingleton>;

declare global {
  var prismaGlobal: undefined | ExtendedPrismaClient;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
