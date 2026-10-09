import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  newCorrelationId,
  newSpanId,
  parseTraceparent,
  formatTraceparent,
  deriveTraceContext,
  currentCorrelationId,
  setCorrelationResolver,
} from "@/lib/correlation";
import {
  withRequestContext,
  withRouteContext,
  getRequestContext,
  getCorrelationId,
  setContextUser,
  outboundTraceHeaders,
  TRACEPARENT_HEADER,
  CORRELATION_HEADER,
} from "@/lib/request-context";

/**
 * SPEC-1's correlation layer (docs/WEEK9-BLUEPRINT.md).
 *
 * What is worth pinning here is not that an id is generated — it is the
 * handful of properties the rest of the week depends on, each of which fails
 * silently if broken:
 *
 *  - an inbound trace is CONTINUED, so a request traced by a proxy does not
 *    get a second identity halfway through;
 *  - a malformed or spec-invalid `traceparent` is REJECTED rather than
 *    propagated, because forwarding a broken trace poisons every downstream
 *    hop;
 *  - the id survives `await` boundaries, which is the entire reason
 *    AsyncLocalStorage is used instead of a parameter;
 *  - and asking for the id outside a request returns null instead of throwing,
 *    because the logger calls it from error paths.
 */

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const ZERO_TRACE = `00-${"0".repeat(32)}-00f067aa0ba902b7-01`;
const ZERO_PARENT = `00-4bf92f3577b34da6a3ce929d0e0e4736-${"0".repeat(16)}-01`;

describe("id generation", () => {
  it("produces W3C-shaped ids", () => {
    expect(newCorrelationId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newCorrelationId()));
    expect(ids.size).toBe(200);
  });

  it("repairs an all-zero id instead of hanging on a dead entropy source", () => {
    // A zero-filling getRandomValues is the worst case: all-zero ids are
    // invalid per spec, and a re-roll loop would spin here forever on the path
    // of every request. The implementation must terminate AND return something
    // valid. If this test ever times out, the loop has come back.
    const spy = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation((arr: any) => {
        (arr as Uint8Array).fill(0);
        return arr;
      });
    try {
      const trace = newCorrelationId();
      const span = newSpanId();
      expect(trace).toMatch(/^[0-9a-f]{32}$/);
      expect(span).toMatch(/^[0-9a-f]{16}$/);
      expect(trace).not.toBe("0".repeat(32));
      expect(span).not.toBe("0".repeat(16));
      // And the repaired value must survive a round trip through the parser,
      // which rejects zero ids — otherwise we would emit a header we reject.
      expect(parseTraceparent(`00-${trace}-${span}-01`)).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to Math.random where Web Crypto is absent", () => {
    // `globalThis.crypto` is a getter-only property on modern Node, so plain
    // assignment throws. vi.stubGlobal redefines it properly and
    // unstubAllGlobals puts it back.
    vi.stubGlobal("crypto", undefined);
    try {
      expect(newCorrelationId()).toMatch(/^[0-9a-f]{32}$/);
      expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("traceparent parsing", () => {
  it("accepts a valid header and round-trips it", () => {
    const ctx = parseTraceparent(VALID);
    expect(ctx).toEqual({
      version: "00",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentId: "00f067aa0ba902b7",
      flags: "01",
    });
    expect(formatTraceparent(ctx!)).toBe(VALID);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(parseTraceparent(`  ${VALID.toUpperCase()}  `)?.traceId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    );
  });

  it("rejects anything it cannot trust", () => {
    const bad = [
      null,
      undefined,
      "",
      "garbage",
      // all-zero trace and parent ids are invalid per spec
      ZERO_TRACE,
      ZERO_PARENT,
      // wrong field widths
      "00-4bf92f3577b34da6-00f067aa0ba902b7-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa-01",
      // non-hex
      "00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-00f067aa0ba902b7-01",
      // a version we do not understand: start a new trace rather than guess
      "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      // missing fields
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7",
    ];
    for (const value of bad) {
      expect(parseTraceparent(value as string | null), String(value)).toBeNull();
    }
  });
});

describe("deriveTraceContext", () => {
  it("continues an inbound trace", () => {
    const ctx = deriveTraceContext(VALID);
    expect(ctx.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("always mints a fresh span, because we are a new hop", () => {
    const ctx = deriveTraceContext(VALID);
    // Reusing the caller's parent id would make two spans indistinguishable.
    expect(ctx.parentId).not.toBe("00f067aa0ba902b7");
    expect(ctx.parentId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("starts a new trace when the inbound header is untrustworthy", () => {
    for (const value of [null, "garbage", ZERO_TRACE]) {
      const ctx = deriveTraceContext(value);
      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.traceId).not.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(ctx.version).toBe("00");
    }
  });
});

describe("the ambient context", () => {
  it("is null outside a request, and asking does not throw", () => {
    expect(getRequestContext()).toBeNull();
    expect(getCorrelationId()).toBeNull();
    expect(outboundTraceHeaders()).toEqual({});
    // setContextUser reports failure rather than exploding.
    expect(setContextUser("u1")).toBe(false);
  });

  it("exposes the id inside the callback", () => {
    withRequestContext({ scope: "test" }, (ctx) => {
      expect(getCorrelationId()).toBe(ctx.correlationId);
      expect(getRequestContext()?.scope).toBe("test");
    });
  });

  it("survives await boundaries — the whole reason for AsyncLocalStorage", async () => {
    await withRequestContext({ scope: "test" }, async (ctx) => {
      await new Promise((r) => setTimeout(r, 5));
      expect(getCorrelationId()).toBe(ctx.correlationId);
      await Promise.all([
        (async () => {
          await new Promise((r) => setTimeout(r, 1));
          expect(getCorrelationId()).toBe(ctx.correlationId);
        })(),
        (async () => {
          expect(getCorrelationId()).toBe(ctx.correlationId);
        })(),
      ]);
    });
  });

  it("keeps concurrent requests separate", async () => {
    const seen: string[] = [];
    const one = withRequestContext({ scope: "a" }, async (ctx) => {
      await new Promise((r) => setTimeout(r, 10));
      seen.push(getCorrelationId()!);
      return ctx.correlationId;
    });
    const two = withRequestContext({ scope: "b" }, async (ctx) => {
      await new Promise((r) => setTimeout(r, 1));
      seen.push(getCorrelationId()!);
      return ctx.correlationId;
    });

    const [a, b] = await Promise.all([one, two]);
    expect(a).not.toBe(b);
    // Each callback saw its OWN id, not whichever ran last.
    expect(seen.sort()).toEqual([a, b].sort());
  });

  it("does not leak out after the callback finishes", async () => {
    await withRequestContext({ scope: "test" }, async () => {
      expect(getCorrelationId()).not.toBeNull();
    });
    expect(getCorrelationId()).toBeNull();
  });

  it("continues an inbound trace through withRequestContext", () => {
    withRequestContext({ scope: "test", inboundTraceparent: VALID }, (ctx) => {
      expect(ctx.correlationId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    });
  });

  it("keeps the id stable when the user is attached mid-request", () => {
    withRequestContext({ scope: "test" }, (ctx) => {
      const before = getCorrelationId();
      expect(setContextUser("user-1")).toBe(true);
      // A changing id mid-request would split one request across two searches.
      expect(getCorrelationId()).toBe(before);
      expect(getRequestContext()?.userId).toBe("user-1");
    });
  });
});

describe("withRouteContext", () => {
  it("reads the traceparent off the request", () => {
    const req = new Request("https://example.test/api/x", {
      headers: { [TRACEPARENT_HEADER]: VALID },
    });
    withRouteContext(req, "api/x", (ctx) => {
      expect(ctx.correlationId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(ctx.scope).toBe("api/x");
    });
  });

  it("mints an id when the caller sent none — the webhook and cron case", () => {
    const req = new Request("https://example.test/api/x");
    withRouteContext(req, "api/x", (ctx) => {
      expect(ctx.correlationId).toMatch(/^[0-9a-f]{32}$/);
    });
  });
});

describe("outbound propagation", () => {
  it("emits both headers so a downstream service can continue the trace", () => {
    withRequestContext({ scope: "test", inboundTraceparent: VALID }, (ctx) => {
      const headers = outboundTraceHeaders();
      expect(headers[CORRELATION_HEADER]).toBe(ctx.correlationId);
      expect(headers[TRACEPARENT_HEADER]).toMatch(
        /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/
      );
    });
  });
});

describe("the resolver seam", () => {
  /**
   * lib/correlation.ts must stay free of `node:` imports so it can be bundled
   * for the browser and the Edge middleware; the Node-only half registers
   * itself. Importing lib/request-context.ts (as this file does at the top) is
   * what wires it up.
   */
  it("is wired up by importing the server-only module", () => {
    withRequestContext({ scope: "test" }, (ctx) => {
      expect(currentCorrelationId()).toBe(ctx.correlationId);
    });
  });

  it("answers null rather than throwing when no resolver is registered", () => {
    setCorrelationResolver(null);
    try {
      expect(currentCorrelationId()).toBeNull();
    } finally {
      setCorrelationResolver(getCorrelationId);
    }
  });

  it("swallows a throwing resolver — the logger calls this from catch blocks", () => {
    setCorrelationResolver(() => {
      throw new Error("resolver exploded");
    });
    try {
      expect(() => currentCorrelationId()).not.toThrow();
      expect(currentCorrelationId()).toBeNull();
    } finally {
      setCorrelationResolver(getCorrelationId);
    }
  });
});

describe("captureError integration", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  async function capture() {
    // Imported lazily so the console spy is in place first.
    const { captureError } = await import("@/lib/observability");
    return captureError;
  }

  it("stamps the ambient correlation id onto a capture", async () => {
    const captureError = await capture();
    let id = "";
    withRequestContext({ scope: "test" }, (ctx) => {
      id = ctx.correlationId;
      captureError(new Error("boom"), { scope: "test", operation: "op" });
    });

    const line = errSpy.mock.calls.at(-1)?.[0] as string;
    expect(line).toContain("[capture]");
    expect(JSON.parse(line.replace("[capture] ", "")).correlationId).toBe(id);
  });

  it("omits the field entirely outside a request, rather than inventing one", async () => {
    const captureError = await capture();
    captureError(new Error("boom"), { scope: "script", operation: "op" });

    const line = errSpy.mock.calls.at(-1)?.[0] as string;
    const payload = JSON.parse(line.replace("[capture] ", ""));
    expect(payload).not.toHaveProperty("correlationId");
    // A null or empty-string id would look like a real one in a log search.
    expect(payload.scope).toBe("script");
  });

  it("lets an explicit id win, for work enqueued by an earlier request", async () => {
    const captureError = await capture();
    withRequestContext({ scope: "worker" }, () => {
      captureError(new Error("boom"), {
        scope: "worker",
        correlationId: "4bf92f3577b34da6a3ce929d0e0e4736",
      });
    });

    const line = errSpy.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(line.replace("[capture] ", "")).correlationId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    );
  });
});
