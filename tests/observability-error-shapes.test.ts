import { describe, it, expect, vi, afterEach } from "vitest";
import { captureError } from "@/lib/observability";
import { isTransientWebSocketError } from "@/lib/prisma";

/**
 * A dropped Neon WebSocket arrives as an ErrorEvent, not an Error. Its useful
 * fields are non-enumerable, so the generic object path logged "{}" and the
 * terminal showed a failure with no cause. It also isn't a global in Node — the
 * driver bundles its own class — so both the retry check and the log formatter
 * match structurally. These pin that.
 */

class ErrorEvent {
  readonly type = "error";
  constructor(
    readonly message: string = "",
    readonly error: unknown = undefined
  ) {}
}

afterEach(() => {
  vi.restoreAllMocks();
});

function capturedPayload(error: unknown): any {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  captureError(error, { scope: "test" }, "warning");
  const line = spy.mock.calls[0]?.[0] as string;
  return JSON.parse(line.slice(line.indexOf("{")));
}

describe("captureError error shapes", () => {
  it("extracts message and stack from an ErrorEvent's underlying error", () => {
    const cause = new Error("websocket closed unexpectedly");
    const payload = capturedPayload(new ErrorEvent("", cause));

    expect(payload.error.name).toBe("ErrorEvent");
    expect(payload.error.message).toBe("websocket closed unexpectedly");
    expect(payload.error.stack).toBe(cause.stack);
  });

  it("prefers the event's own message when it has one", () => {
    expect(capturedPayload(new ErrorEvent("connection reset")).error.message).toBe(
      "connection reset"
    );
  });

  it("never logs an empty message for an ErrorEvent carrying neither", () => {
    expect(capturedPayload(new ErrorEvent()).error.message).toBe("(no message)");
  });

  it("still handles a plain Error", () => {
    const payload = capturedPayload(new Error("boom"));

    expect(payload.error.name).toBe("Error");
    expect(payload.error.message).toBe("boom");
  });
});

describe("isTransientWebSocketError", () => {
  it("matches a driver ErrorEvent so the query is retried", () => {
    expect(isTransientWebSocketError(new ErrorEvent("connection reset"))).toBe(true);
  });

  it("does not match an ordinary Error", () => {
    expect(isTransientWebSocketError(new Error("constraint violation"))).toBe(false);
  });

  it("does not match null or a plain object", () => {
    expect(isTransientWebSocketError(null)).toBe(false);
    expect(isTransientWebSocketError({ type: "error" })).toBe(false);
  });
});
