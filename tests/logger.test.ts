import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, logDuration } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/**
 * The structured logger (SPEC-1, docs/WEEK9-BLUEPRINT.md).
 *
 * The properties worth pinning are the ones whose failure is silent:
 *
 *  - every line is ONE parseable JSON object, because a logger whose output
 *    cannot be parsed is a logger nobody can query;
 *  - the correlation id is attached automatically, since the whole point is
 *    grouping lines from one request;
 *  - warn/error go to stderr and everything else to stdout, so error alerting
 *    does not have to parse the level out of a merged stream;
 *  - and it never throws, because it is called from catch blocks.
 */

const PREFIX = "[log] ";

/** Parse the JSON back out of a captured console line. */
function parsed(call: unknown[] | undefined): Record<string, unknown> {
  const line = call?.[0] as string;
  expect(line.startsWith(PREFIX), `missing prefix: ${line}`).toBe(true);
  return JSON.parse(line.slice(PREFIX.length));
}

describe("logger", () => {
  let outSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    outSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // NODE_ENV is "test" under vitest, which silences the logger by default so
    // suites do not spray output. These tests are about the logger, so they
    // opt back in explicitly.
    process.env.LOG_LEVEL = "debug";
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  });

  it("emits one line of parseable JSON with the event and level", () => {
    log.info("thing.happened", { count: 3, ok: true });

    const payload = parsed(outSpy.mock.calls.at(-1));
    expect(payload.level).toBe("info");
    expect(payload.event).toBe("thing.happened");
    expect(payload.count).toBe(3);
    expect(payload.ok).toBe(true);
    expect(typeof payload.at).toBe("string");
  });

  it("sends warn and error to stderr, info and debug to stdout", () => {
    log.debug("d");
    log.info("i");
    expect(outSpy).toHaveBeenCalledTimes(2);

    log.warn("w");
    log.error("e");
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it("attaches the ambient correlation id", () => {
    let id = "";
    withRequestContext({ scope: "test" }, (ctx) => {
      id = ctx.correlationId;
      log.info("inside.request");
    });
    expect(parsed(outSpy.mock.calls.at(-1)).correlationId).toBe(id);
  });

  it("omits the id outside a request rather than emitting a blank one", () => {
    log.info("outside.request");
    // An empty string or null would match a log search for a real id.
    expect(parsed(outSpy.mock.calls.at(-1))).not.toHaveProperty("correlationId");
  });

  it("drops undefined fields but keeps null, which is a real value", () => {
    log.info("fields", { present: 1, absent: undefined, explicitlyNull: null });
    const payload = parsed(outSpy.mock.calls.at(-1));
    expect(payload).not.toHaveProperty("absent");
    expect(payload.explicitlyNull).toBeNull();
    expect(payload.present).toBe(1);
  });

  it("respects LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    log.debug("d");
    log.info("i");
    expect(outSpy).not.toHaveBeenCalled();

    log.warn("w");
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("is silent by default under test, so suites do not spray output", () => {
    delete process.env.LOG_LEVEL;
    log.info("i");
    log.error("e");
    expect(outSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("never throws, even on an unserialisable field", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // Deliberately defeating the type to simulate a caller passing junk — the
    // logger is called from catch blocks and must not add a second failure.
    expect(() => log.info("circular", circular as never)).not.toThrow();

    const payload = parsed(outSpy.mock.calls.at(-1));
    expect(payload.unserialisable).toBe(true);
    // The event name survives, so the line is still useful.
    expect(payload.event).toBe("circular");
  });
});

describe("logDuration", () => {
  let outSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    outSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.LOG_LEVEL = "debug";
  });
  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  });

  it("logs a duration and returns the value on success", async () => {
    const result = await logDuration("op", { entityId: "x1" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 42;
    });

    expect(result).toBe(42);
    const payload = parsed(outSpy.mock.calls.at(-1));
    expect(payload.ok).toBe(true);
    expect(payload.entityId).toBe("x1");
    expect(payload.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it("logs the failure and RETHROWS — it measures, it does not swallow", async () => {
    await expect(
      logDuration("op", {}, async () => {
        throw new TypeError("nope");
      })
    ).rejects.toThrow("nope");

    const payload = parsed(errSpy.mock.calls.at(-1));
    expect(payload.ok).toBe(false);
    expect(payload.errorName).toBe("TypeError");
    // The message is NOT logged here: it can carry caller data, and the
    // structured capture in lib/observability.ts is where detail belongs.
    expect(JSON.stringify(payload)).not.toContain("nope");
  });

  it("carries the correlation id through the timed operation", async () => {
    let id = "";
    await withRequestContext({ scope: "test" }, async (ctx) => {
      id = ctx.correlationId;
      await logDuration("op", {}, async () => "done");
    });
    expect(parsed(outSpy.mock.calls.at(-1)).correlationId).toBe(id);
  });
});
