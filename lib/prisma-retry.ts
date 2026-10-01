/**
 * When a failed query may be run again, as pure predicates.
 *
 * Separate from lib/prisma.ts on purpose: that module instantiates a Neon
 * connection pool at import time, so anything importing it opens a socket.
 * These two functions are the part worth testing, and a unit test for them
 * should not need a database — or leave a WebSocket open after it finishes.
 */

/**
 * Operations that can be retried without the risk of applying them twice.
 *
 * This list is why the retry is split by operation rather than applied to
 * everything. A dropped connection is AMBIGUOUS for a write: the statement may
 * have committed on the server a moment before the socket died, and the client
 * cannot tell. Retrying it would be how a donation gets recorded twice — the
 * exact failure the ledger and its idempotency keys exist to prevent,
 * reintroduced one layer lower down where nothing would catch it.
 *
 * Reads have no such hazard. Running a findMany twice costs a round trip.
 */
export const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * A connection that died underneath us, as reported by the ADAPTER rather than
 * by Prisma.
 *
 * Prisma's own retryable codes cover a cold Neon endpoint failing to CONNECT.
 * They do not cover a connection that was established and then dropped: the
 * Neon serverless driver speaks WebSocket, and a dropped socket surfaces as a
 * DOM-style `ErrorEvent` — `{ type: 'error' }`, no `code`, no `message`. That
 * fell straight through the retry predicate and became a 500 on pages that
 * only needed their query run again.
 *
 * It is also why the user-facing error read literally "ErrorEvent": there is
 * no message on these objects to show.
 */
export function isConnectionDropped(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { type?: unknown }).type === "error") return true;
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /connection terminated|connection closed|socket hang up|ECONNRESET|websocket/i.test(message)
  );
}

/** Whether a dropped connection may be retried for this operation. */
export function mayRetryAfterDroppedConnection(operation: string | undefined): boolean {
  return operation !== undefined && READ_OPERATIONS.has(operation);
}
