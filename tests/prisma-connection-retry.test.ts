import { describe, it, expect } from "vitest";
import { isConnectionDropped, mayRetryAfterDroppedConnection } from "@/lib/prisma-retry";

/**
 * What these tests protect.
 *
 * Two failures, pulling in opposite directions.
 *
 * The first is the one that was live: the retry wrapper recognised Prisma's
 * own connection codes but not the adapter's. Neon speaks WebSocket, and a
 * dropped socket arrives as a DOM-style ErrorEvent with no code and no
 * message, so it fell through every branch and became a 500 on a page that
 * only needed its query run again.
 *
 * Imported from lib/prisma-retry rather than lib/prisma: that module builds a
 * Neon connection pool at import time, and a unit test for two pure
 * predicates has no business opening a socket — or leaving one open after it
 * finishes.
 *
 * The second is the one a careless fix would introduce. A dropped connection
 * is AMBIGUOUS for a write — the statement may have committed a moment before
 * the socket died — so retrying one could apply a payment twice, underneath
 * every idempotency guard built above it. Reads are retried; writes are not.
 */

describe("recognising a dropped connection", () => {
  it("catches the ErrorEvent the Neon driver actually emits", () => {
    // Exactly the shape seen in the dev server log: no code, no message.
    expect(
      isConnectionDropped({
        type: "error",
        defaultPrevented: false,
        cancelable: false,
        timeStamp: 533039.1947,
      }),
    ).toBe(true);
  });

  it("catches the message-bearing variants", () => {
    for (const message of [
      "Connection terminated unexpectedly",
      "connection closed",
      "socket hang up",
      "read ECONNRESET",
      "WebSocket was closed before the connection was established",
    ]) {
      expect(isConnectionDropped(new Error(message))).toBe(true);
    }
  });

  it("does not claim ordinary errors are connection failures", () => {
    // Retrying a genuine application error would turn one failure into five.
    expect(isConnectionDropped(new Error("Unique constraint failed"))).toBe(false);
    expect(isConnectionDropped({ code: "P2002" })).toBe(false);
    expect(isConnectionDropped(null)).toBe(false);
    expect(isConnectionDropped(undefined)).toBe(false);
    expect(isConnectionDropped("error")).toBe(false);
    expect(isConnectionDropped({ type: "click" })).toBe(false);
  });
});

describe("what may be retried after the socket dies", () => {
  it("retries reads", () => {
    for (const op of [
      "findUnique",
      "findUniqueOrThrow",
      "findFirst",
      "findFirstOrThrow",
      "findMany",
      "count",
      "aggregate",
      "groupBy",
    ]) {
      expect(mayRetryAfterDroppedConnection(op)).toBe(true);
    }
  });

  it("never retries a write", () => {
    // The statement may have committed before the socket died, and the client
    // cannot tell. A retried create is a second payment.
    for (const op of [
      "create",
      "createMany",
      "update",
      "updateMany",
      "upsert",
      "delete",
      "deleteMany",
      "executeRaw",
      "$executeRaw",
    ]) {
      expect(mayRetryAfterDroppedConnection(op)).toBe(false);
    }
  });

  it("does not retry an unknown operation", () => {
    // Anything not explicitly known to be safe is treated as unsafe.
    expect(mayRetryAfterDroppedConnection(undefined)).toBe(false);
    expect(mayRetryAfterDroppedConnection("somethingNew")).toBe(false);
  });
});
